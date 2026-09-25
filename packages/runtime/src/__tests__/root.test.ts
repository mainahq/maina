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
	type GitProbe,
	gitProbe,
	type NoRepo,
	type Root,
	type RootInputs,
	type RootSource,
	resolveRoot,
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
	];

	for (const [name, inputs, expected] of cases) {
		test(name, () => {
			expect(resolveRoot(inputs, git)).toEqual(expected);
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

	test("a cwd outside a repo refuses", () => {
		expect(resolveRoot({ cwd: "/Users/me" }, git)).toEqual(
			refused("cwd", ["/Users/me"]),
		);
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
