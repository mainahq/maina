/**
 * Root resolution (FR-INS-3).
 *
 * `resolveRoot` picks the repository maina operates on. Precedence:
 * explicit > host project dir > MCP roots > git root of cwd. The first source
 * that is provided decides; a provided source outside any repository refuses
 * with `NoRepo` rather than falling through, so maina never writes state into
 * `$HOME`, `/tmp` or a neighbouring repository.
 *
 * Precedence is covered with an in-memory probe; nested repos, worktrees and
 * the refusal path run against real temporary git repositories.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Result } from "@mainahq/core";
import {
	asyncGitProbe,
	checkedOutBranch,
	type GitProbe,
	gitProbe,
	type NoRepo,
	probeEnv,
	type Root,
	type RootInputs,
	type RootSource,
	resolveRoot,
	resolveRootAsync,
} from "../root";

type Resolved = Result<Root, NoRepo>;

const found = (path: string, source: RootSource): Resolved => ({
	ok: true,
	value: { path, source },
});

const refused = (source: RootSource, tried: readonly string[]): Resolved => ({
	ok: false,
	error: { kind: "no_repo", source, tried },
});

/** Probe over a fixed set of repo roots: a dir belongs to the longest root prefixing it. */
const fakeProbe = (roots: readonly string[]): GitProbe => ({
	toplevel: (dir) => {
		const hits = roots.filter((r) => dir === r || dir.startsWith(`${r}/`));
		return hits.sort((a, b) => b.length - a.length)[0] ?? null;
	},
});

describe("resolveRoot precedence", () => {
	const git = fakeProbe([
		"/repo/explicit",
		"/repo/host",
		"/repo/mcp",
		"/repo/cwd",
	]);

	const cases: ReadonlyArray<
		readonly [name: string, inputs: RootInputs, expected: Resolved]
	> = [
		[
			"explicit wins over every other source",
			{
				explicit: "/repo/explicit",
				hostProjectDir: "/repo/host",
				mcpRoots: ["/repo/mcp"],
				cwd: "/repo/cwd",
			},
			found("/repo/explicit", "explicit"),
		],
		[
			"host project dir wins over MCP roots and cwd",
			{
				hostProjectDir: "/repo/host",
				mcpRoots: ["/repo/mcp"],
				cwd: "/repo/cwd",
			},
			found("/repo/host", "host"),
		],
		[
			"MCP roots win over cwd",
			{ mcpRoots: ["/repo/mcp"], cwd: "/repo/cwd" },
			found("/repo/mcp", "mcp"),
		],
		[
			"falls back to the git root of cwd",
			{ cwd: "/repo/cwd/packages/a" },
			found("/repo/cwd", "cwd"),
		],
		[
			"a subdirectory resolves to its repository root",
			{ explicit: "/repo/host/src/deep", cwd: "/" },
			found("/repo/host", "explicit"),
		],
		[
			"a relative explicit dir resolves against cwd",
			{ explicit: "../host", cwd: "/repo/cwd" },
			found("/repo/host", "explicit"),
		],
		[
			"a relative host project dir resolves against cwd",
			{ hostProjectDir: "sub", cwd: "/repo/cwd" },
			found("/repo/cwd", "host"),
		],
		[
			"blank values and empty MCP root lists count as not provided",
			{ explicit: "", hostProjectDir: "  ", mcpRoots: [], cwd: "/repo/cwd" },
			found("/repo/cwd", "cwd"),
		],
		[
			"the first MCP root inside a repository wins",
			{
				mcpRoots: ["/elsewhere", "/repo/mcp/a", "/repo/host"],
				cwd: "/repo/cwd",
			},
			found("/repo/mcp", "mcp"),
		],
		[
			"MCP roots given as file:// URIs are accepted",
			{
				mcpRoots: [pathToFileURL("/repo/mcp/sub dir").href],
				cwd: "/repo/cwd",
			},
			found("/repo/mcp", "mcp"),
		],
		[
			"single-slash file: URIs are accepted",
			{ mcpRoots: ["file:/repo/mcp/a"], cwd: "/repo/cwd" },
			found("/repo/mcp", "mcp"),
		],
		[
			"file URI schemes are case-insensitive",
			{ mcpRoots: ["FILE:///repo/mcp/a"], cwd: "/repo/cwd" },
			found("/repo/mcp", "mcp"),
		],
		[
			"file://localhost/ URIs name a local path",
			{ mcpRoots: ["file://localhost/repo/mcp/a"], cwd: "/repo/cwd" },
			found("/repo/mcp", "mcp"),
		],
	];

	for (const [name, inputs, expected] of cases) {
		test(name, () => {
			expect(resolveRoot(inputs, git)).toEqual(expected);
		});
	}

	// The async resolver, for callers that must not block the event loop,
	// applies exactly the same precedence.
	const asyncGit = { toplevel: async (dir: string) => git.toplevel(dir) };
	for (const [name, inputs, expected] of cases) {
		test(`async: ${name}`, async () => {
			expect(await resolveRootAsync(inputs, asyncGit)).toEqual(expected);
		});
	}
});

describe("resolveRoot refusal", () => {
	const git = fakeProbe(["/repo/cwd"]);

	test("an explicit dir outside a repo refuses instead of falling back to cwd", () => {
		expect(
			resolveRoot({ explicit: "/home/me", cwd: "/repo/cwd" }, git),
		).toEqual(refused("explicit", ["/home/me"]));
	});

	test("a host project dir outside a repo refuses instead of falling back", () => {
		expect(
			resolveRoot({ hostProjectDir: "/tmp", cwd: "/repo/cwd" }, git),
		).toEqual(refused("host", ["/tmp"]));
	});

	test("MCP roots all outside repos refuse and list every root tried", () => {
		expect(
			resolveRoot({ mcpRoots: ["/a", "/b"], cwd: "/repo/cwd" }, git),
		).toEqual(refused("mcp", ["/a", "/b"]));
	});

	test("MCP roots that name no local path are never resolved against cwd", () => {
		const remote = [
			"file://build-host/repo/cwd",
			"vscode-remote://ssh/repo/cwd",
			"untitled:repo/cwd",
		];
		expect(resolveRoot({ mcpRoots: remote, cwd: "/repo/cwd" }, git)).toEqual(
			refused("mcp", remote),
		);
	});

	test("relative inputs with a relative cwd refuse without probing", () => {
		const probed: string[] = [];
		const anyDir: GitProbe = {
			toplevel: (dir) => {
				probed.push(dir);
				return dir;
			},
		};
		expect(resolveRoot({ explicit: "sub", cwd: "rel" }, anyDir)).toEqual(
			refused("explicit", ["sub"]),
		);
		expect(resolveRoot({ cwd: "rel" }, anyDir)).toEqual(
			refused("cwd", ["rel"]),
		);
		expect(probed).toEqual([]);
	});

	test("a cwd outside a repo refuses", () => {
		expect(resolveRoot({ cwd: "/Users/me" }, git)).toEqual(
			refused("cwd", ["/Users/me"]),
		);
	});
});

describe("resolveRoot when $HOME is itself a repository (dotfiles)", () => {
	const home = "/home/me";
	const git = fakeProbe([home, "/home/me/projects/app", "/repo/cwd"]);

	test("a cwd inside the home repo refuses instead of resolving to $HOME", () => {
		expect(resolveRoot({ cwd: "/home/me/scratch", home }, git)).toEqual(
			refused("cwd", ["/home/me/scratch"]),
		);
		expect(resolveRoot({ cwd: home, home }, git)).toEqual(
			refused("cwd", [home]),
		);
	});

	test("a host project dir resolving to $HOME refuses instead of falling back", () => {
		expect(
			resolveRoot(
				{ hostProjectDir: "/home/me/notes", cwd: "/repo/cwd", home },
				git,
			),
		).toEqual(refused("host", ["/home/me/notes"]));
	});

	test("an MCP root resolving to $HOME is skipped in favour of the next root", () => {
		expect(
			resolveRoot(
				{ mcpRoots: ["/home/me/notes", "/repo/cwd/a"], cwd: "/", home },
				git,
			),
		).toEqual(found("/repo/cwd", "mcp"));
		expect(
			resolveRoot({ mcpRoots: ["/home/me/notes", "/b"], cwd: "/", home }, git),
		).toEqual(refused("mcp", ["/home/me/notes", "/b"]));
	});

	test("an explicit root may still choose $HOME", () => {
		expect(
			resolveRoot(
				{ explicit: "/home/me/scratch", cwd: "/repo/cwd", home },
				git,
			),
		).toEqual(found(home, "explicit"));
	});

	test("a repository nested inside $HOME still resolves", () => {
		expect(
			resolveRoot({ cwd: "/home/me/projects/app/src", home }, git),
		).toEqual(found("/home/me/projects/app", "cwd"));
	});

	test("home is compared after normalisation", () => {
		expect(
			resolveRoot({ cwd: "/home/me/scratch", home: "/home/me/" }, git),
		).toEqual(refused("cwd", ["/home/me/scratch"]));
		expect(
			resolveRoot({ cwd: "/home/me/scratch", home: "/home/x/../me" }, git),
		).toEqual(refused("cwd", ["/home/me/scratch"]));
	});

	test("a blank home is ignored", () => {
		expect(resolveRoot({ cwd: "/home/me/scratch", home: " " }, git)).toEqual(
			found(home, "cwd"),
		);
	});

	test("a repository at the filesystem root refuses unless explicit", () => {
		const rootRepo: GitProbe = { toplevel: () => "/" };
		expect(resolveRoot({ cwd: "/srv/app", home }, rootRepo)).toEqual(
			refused("cwd", ["/srv/app"]),
		);
		expect(resolveRoot({ cwd: "/srv/app" }, rootRepo)).toEqual(
			refused("cwd", ["/srv/app"]),
		);
		expect(
			resolveRoot({ explicit: "/srv/app", cwd: "/srv/app", home }, rootRepo),
		).toEqual(found("/", "explicit"));
	});
});

// ── Real git repositories ───────────────────────────────────────────────────

const git = (cwd: string, ...args: string[]): void => {
	const p = Bun.spawnSync(["git", ...args], {
		cwd,
		stdout: "ignore",
		stderr: "pipe",
		env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
	});
	if (p.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${p.stderr.toString()}`);
	}
};

const initRepo = (dir: string): void => {
	mkdirSync(dir, { recursive: true });
	git(dir, "init", "-q");
	git(dir, "config", "user.email", "t@example.com");
	git(dir, "config", "user.name", "t");
	git(dir, "config", "commit.gpgsign", "false");
};

/** Every path under `dir`, so a test can prove nothing was written. */
const snapshot = (dir: string): readonly string[] =>
	readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();

describe("resolveRoot with real repositories", () => {
	let base = "";
	let outer = "";
	let inner = "";
	let worktree = "";
	let home = "";

	beforeAll(() => {
		base = realpathSync(mkdtempSync(join(tmpdir(), "maina-root-")));
		outer = join(base, "outer");
		inner = join(outer, "vendor", "inner");
		worktree = join(base, "outer-wt");
		home = join(base, "home");

		initRepo(outer);
		writeFileSync(join(outer, "README.md"), "outer\n");
		git(outer, "add", "README.md");
		git(outer, "commit", "-q", "-m", "init");
		mkdirSync(join(outer, "src", "deep"), { recursive: true });

		initRepo(inner);
		mkdirSync(join(inner, "lib"), { recursive: true });

		git(outer, "worktree", "add", "-q", worktree, "-b", "wt");
		mkdirSync(join(worktree, "src", "deep"), { recursive: true });

		mkdirSync(join(home, "projects"), { recursive: true });
		writeFileSync(join(home, ".profile"), "# fake home\n");
	});

	afterAll(() => {
		if (base) rmSync(base, { recursive: true, force: true });
	});

	test("cwd deep inside a repo resolves to its root", () => {
		expect(resolveRoot({ cwd: join(outer, "src", "deep") }, gitProbe)).toEqual(
			found(outer, "cwd"),
		);
	});

	test("nested repos resolve to the nearest root", () => {
		expect(resolveRoot({ cwd: join(inner, "lib") }, gitProbe)).toEqual(
			found(inner, "cwd"),
		);
		expect(resolveRoot({ cwd: join(outer, "vendor") }, gitProbe)).toEqual(
			found(outer, "cwd"),
		);
	});

	test("a linked worktree resolves to the worktree, not the main checkout", () => {
		expect(
			resolveRoot({ cwd: join(worktree, "src", "deep") }, gitProbe),
		).toEqual(found(worktree, "cwd"));
	});

	test("an explicit worktree path beats a cwd in the main checkout", () => {
		expect(resolveRoot({ explicit: worktree, cwd: outer }, gitProbe)).toEqual(
			found(worktree, "explicit"),
		);
	});

	test("a $HOME-like dir outside any repo returns NoRepo and writes nothing", () => {
		const before = snapshot(home);
		expect(resolveRoot({ cwd: home }, gitProbe)).toEqual(
			refused("cwd", [home]),
		);
		expect(snapshot(home)).toEqual(before);
	});

	test("a /tmp-like dir outside any repo returns NoRepo and writes nothing", () => {
		const scratch = join(base, "tmp");
		mkdirSync(scratch);
		expect(resolveRoot({ cwd: scratch }, gitProbe)).toEqual(
			refused("cwd", [scratch]),
		);
		expect(snapshot(scratch)).toEqual([]);
	});

	test("a host project dir outside a repo refuses even when cwd is a repo", () => {
		const before = snapshot(home);
		expect(resolveRoot({ hostProjectDir: home, cwd: outer }, gitProbe)).toEqual(
			refused("host", [home]),
		);
		expect(snapshot(home)).toEqual(before);
	});

	test("a missing directory is treated as outside any repo", () => {
		const missing = join(base, "does-not-exist");
		expect(gitProbe.toplevel(missing)).toBeNull();
		expect(resolveRoot({ explicit: missing, cwd: outer }, gitProbe)).toEqual(
			refused("explicit", [missing]),
		);
	});

	test("the probe honours GIT_CEILING_DIRECTORIES and refuses above it", () => {
		const saved = process.env.GIT_CEILING_DIRECTORIES;
		process.env.GIT_CEILING_DIRECTORIES = outer;
		try {
			expect(gitProbe.toplevel(join(outer, "src", "deep"))).toBeNull();
		} finally {
			if (saved === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
			else process.env.GIT_CEILING_DIRECTORIES = saved;
		}
	});

	test("the async probe resolves like the sync probe without blocking", async () => {
		const pending = asyncGitProbe.toplevel(join(outer, "src", "deep"));
		expect(pending).toBeInstanceOf(Promise);
		expect(await pending).toBe(outer);
		expect(await asyncGitProbe.toplevel(join(inner, "lib"))).toBe(inner);
		expect(await asyncGitProbe.toplevel(home)).toBeNull();
		expect(
			await asyncGitProbe.toplevel(join(base, "does-not-exist")),
		).toBeNull();
		expect(
			await resolveRootAsync({ cwd: join(worktree, "src") }, asyncGitProbe),
		).toEqual(found(worktree, "cwd"));
		expect(await resolveRootAsync({ cwd: home }, asyncGitProbe)).toEqual(
			refused("cwd", [home]),
		);
	});

	test("the async probe ignores an inherited GIT_DIR", async () => {
		const saved = process.env.GIT_DIR;
		process.env.GIT_DIR = join(outer, ".git");
		try {
			expect(await asyncGitProbe.toplevel(home)).toBeNull();
		} finally {
			if (saved === undefined) delete process.env.GIT_DIR;
			else process.env.GIT_DIR = saved;
		}
	});

	test("a temp $HOME that is a git repo refuses non-explicit roots and writes nothing", () => {
		const dotHome = join(base, "dothome");
		initRepo(dotHome);
		writeFileSync(join(dotHome, ".profile"), "# dotfiles\n");
		mkdirSync(join(dotHome, "scratch"), { recursive: true });
		const app = join(dotHome, "projects", "app");
		initRepo(app);
		mkdirSync(join(app, "src"), { recursive: true });

		const home = dotHome;
		const before = snapshot(dotHome);
		const scratch = join(dotHome, "scratch");
		expect(resolveRoot({ cwd: scratch, home }, gitProbe)).toEqual(
			refused("cwd", [scratch]),
		);
		expect(
			resolveRoot({ hostProjectDir: scratch, cwd: outer, home }, gitProbe),
		).toEqual(refused("host", [scratch]));
		expect(
			resolveRoot(
				{ mcpRoots: [pathToFileURL(scratch).href], cwd: outer, home },
				gitProbe,
			),
		).toEqual(refused("mcp", [scratch]));
		expect(snapshot(dotHome)).toEqual(before);

		expect(
			resolveRoot({ explicit: scratch, cwd: outer, home }, gitProbe),
		).toEqual(found(dotHome, "explicit"));
		expect(resolveRoot({ cwd: join(app, "src"), home }, gitProbe)).toEqual(
			found(app, "cwd"),
		);
	});

	test("the async resolver refuses a $HOME top level the same way", async () => {
		const dotHome = join(base, "dothome-async");
		initRepo(dotHome);
		const scratch = join(dotHome, "scratch");
		mkdirSync(scratch, { recursive: true });
		const home = dotHome;

		expect(
			await resolveRootAsync({ cwd: scratch, home }, asyncGitProbe),
		).toEqual(refused("cwd", [scratch]));
		expect(
			await resolveRootAsync(
				{ explicit: scratch, cwd: outer, home },
				asyncGitProbe,
			),
		).toEqual(found(dotHome, "explicit"));
	});

	test("the probe ignores an inherited GIT_DIR", () => {
		const saved = process.env.GIT_DIR;
		process.env.GIT_DIR = join(outer, ".git");
		try {
			expect(gitProbe.toplevel(home)).toBeNull();
			expect(gitProbe.toplevel(join(inner, "lib"))).toBe(inner);
		} finally {
			if (saved === undefined) delete process.env.GIT_DIR;
			else process.env.GIT_DIR = saved;
		}
	});
});

describe("checkedOutBranch (#459)", () => {
	let base = "";
	beforeAll(() => {
		base = realpathSync(mkdtempSync(join(tmpdir(), "maina-branch-")));
	});
	afterAll(() => {
		if (base) rmSync(base, { recursive: true, force: true });
	});

	test("names the branch checked out, even before the first commit", async () => {
		const repo = join(base, "unborn");
		initRepo(repo);
		git(repo, "checkout", "-q", "-b", "v1/main");
		expect(await checkedOutBranch(repo)).toBe("v1/main");
		writeFileSync(join(repo, "a.txt"), "a\n");
		git(repo, "add", "a.txt");
		git(repo, "commit", "-q", "-m", "init");
		git(repo, "checkout", "-q", "-b", "feature/x");
		expect(await checkedOutBranch(repo)).toBe("feature/x");
		// A tag of the same name makes `--short` print `heads/feature/x`.
		git(repo, "tag", "feature/x");
		expect(await checkedOutBranch(repo)).toBe("feature/x");
	});

	test("is null for a detached HEAD or a directory outside any repository", async () => {
		const repo = join(base, "detached");
		initRepo(repo);
		writeFileSync(join(repo, "a.txt"), "a\n");
		git(repo, "add", "a.txt");
		git(repo, "commit", "-q", "-m", "init");
		git(repo, "checkout", "-q", "--detach");
		expect(await checkedOutBranch(repo)).toBeNull();
		const plain = join(base, "plain");
		mkdirSync(plain);
		expect(await checkedOutBranch(plain)).toBeNull();
		expect(await checkedOutBranch(join(base, "missing"))).toBeNull();
	});
});

describe("probeEnv", () => {
	test("drops every repo-local GIT_* variable core's process adapter drops", () => {
		expect(
			probeEnv({
				PATH: "/bin",
				GIT_DIR: "/outer/.git",
				GIT_CONFIG_PARAMETERS: "'core.worktree'='/elsewhere'",
				GIT_CONFIG_COUNT: "1",
				GIT_NO_REPLACE_OBJECTS: "1",
				GIT_ALTERNATE_OBJECT_DIRECTORIES: "/outer/.git/objects",
				GIT_CEILING_DIRECTORIES: "/home",
				GIT_SSH_COMMAND: "ssh",
			}),
		).toEqual({
			PATH: "/bin",
			GIT_CEILING_DIRECTORIES: "/home",
			GIT_SSH_COMMAND: "ssh",
		});
	});
});
