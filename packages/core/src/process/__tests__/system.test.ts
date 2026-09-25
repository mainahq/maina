/**
 * Issue #420: the real `ProcessPort` adapter, the one place core spawns a
 * child process. It never rejects, reports non-zero exits as data, and does
 * not leak repository-locating `GIT_*` variables (GIT_DIR, GIT_INDEX_FILE,
 * ...) from the parent into children unless an env is passed explicitly.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createSystemProcess,
	indexFileBelongsTo,
	stripRepoLocalGitEnv,
	systemProcess,
} from "../index";

const BUN = process.execPath;

/** A `bun -e` script printing the named variables, `|`-joined. */
function printEnv(...names: readonly string[]): string {
	const reads = names.map((n) => `String(process.env[${JSON.stringify(n)}])`);
	return `process.stdout.write([${reads.join(", ")}].join("|"))`;
}

describe("stripRepoLocalGitEnv", () => {
	test("drops git's repo-local variables but keeps transport and auth ones", () => {
		expect(
			stripRepoLocalGitEnv({
				PATH: "/bin",
				GIT_DIR: "/outer/.git",
				GIT_WORK_TREE: "/outer",
				GIT_INDEX_FILE: "/outer/.git/index",
				GIT_COMMON_DIR: "/outer/.git",
				GIT_OBJECT_DIRECTORY: "/outer/.git/objects",
				GIT_PREFIX: "src/",
				GIT_SSH_COMMAND: "ssh -i key",
				GIT_ASKPASS: "/bin/askpass",
				GIT_TERMINAL_PROMPT: "0",
			}),
		).toEqual({
			PATH: "/bin",
			GIT_SSH_COMMAND: "ssh -i key",
			GIT_ASKPASS: "/bin/askpass",
			GIT_TERMINAL_PROMPT: "0",
		});
	});

	test("keeps GIT_INDEX_FILE only when asked (the index belongs to the child's repo)", () => {
		const env = {
			PATH: "/bin",
			GIT_DIR: "/repo/.git",
			GIT_INDEX_FILE: "/repo/.git/index.lock",
		};
		expect(stripRepoLocalGitEnv(env, { keepIndexFile: true })).toEqual({
			PATH: "/bin",
			GIT_INDEX_FILE: "/repo/.git/index.lock",
		});
		expect(stripRepoLocalGitEnv(env, { keepIndexFile: false })).toEqual({
			PATH: "/bin",
		});
	});
});

describe("indexFileBelongsTo", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function scratch(): string {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "maina-idx-")));
		dirs.push(dir);
		return dir;
	}

	test("an index inside the cwd's .git directory belongs to it", () => {
		const repo = scratch();
		mkdirSync(join(repo, ".git"));
		mkdirSync(join(repo, "src"));
		expect(
			indexFileBelongsTo(join(repo, ".git", "index.lock"), join(repo, "src")),
		).toBe(true);
		expect(
			indexFileBelongsTo(join(repo, ".git", "next-index-42.lock"), repo),
		).toBe(true);
	});

	test("a linked worktree's index belongs to the worktree named by its .git file", () => {
		const main = scratch();
		const wtGitDir = join(main, ".git", "worktrees", "wt");
		mkdirSync(wtGitDir, { recursive: true });
		const wt = scratch();
		writeFileSync(join(wt, ".git"), `gitdir: ${wtGitDir}\n`);
		expect(indexFileBelongsTo(join(wtGitDir, "index.lock"), wt)).toBe(true);
		expect(indexFileBelongsTo(join(main, ".git", "index.lock"), wt)).toBe(
			false,
		);
	});

	test("another repository's index, a relative path or no repo does not belong", () => {
		const outer = scratch();
		const fixture = scratch();
		mkdirSync(join(outer, ".git"));
		mkdirSync(join(fixture, ".git"));
		expect(indexFileBelongsTo(join(outer, ".git", "index"), fixture)).toBe(
			false,
		);
		expect(indexFileBelongsTo(".git/index.lock", fixture)).toBe(false);
		expect(indexFileBelongsTo(join(outer, ".git", "index"), scratch())).toBe(
			false,
		);
	});
});

describe("systemProcess.spawn", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("captures exit code, stdout and stderr in the given cwd", async () => {
		const cwd = realpathSync(mkdtempSync(join(tmpdir(), "maina-proc-")));
		dirs.push(cwd);
		const result = await systemProcess.spawn(
			[
				BUN,
				"-e",
				"process.stdout.write(process.cwd()); process.stderr.write('warn'); process.exit(3)",
			],
			{ cwd },
		);
		expect(result).toEqual({
			ok: true,
			value: { exitCode: 3, stdout: cwd, stderr: "warn" },
		});
	});

	test("a missing binary is a spawn_failed error, never a rejection", async () => {
		const result = await systemProcess.spawn(
			["maina-definitely-not-a-binary-420"],
			{ cwd: tmpdir() },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("spawn_failed");
	});

	test("kills a child that outlives timeoutMs and reports a timeout", async () => {
		const result = await systemProcess.spawn(
			[BUN, "-e", "setTimeout(() => {}, 10000)"],
			{ cwd: tmpdir(), timeoutMs: 100 },
		);
		expect(result).toEqual({
			ok: false,
			error: { kind: "timeout", timeoutMs: 100 },
		});
	});

	test("a timeout returns promptly even when a grandchild holds the pipes", async () => {
		// `sh` forks `sleep`, which inherits stdout/stderr; killing `sh` alone
		// leaves the pipes open until `sleep` exits.
		const startedAt = Date.now();
		const result = await systemProcess.spawn(
			["sh", "-c", "sleep 5; echo done"],
			{ cwd: tmpdir(), timeoutMs: 200 },
		);
		expect(result).toEqual({
			ok: false,
			error: { kind: "timeout", timeoutMs: 200 },
		});
		expect(Date.now() - startedAt).toBeLessThan(2000);
	});

	test("does not leak the parent's GIT_DIR / GIT_INDEX_FILE by default", async () => {
		// The host process itself starts with the leaked variables, as it
		// would when launched from a git hook.
		const host = [
			`import { systemProcess } from ${JSON.stringify(join(import.meta.dir, "..", "index.ts"))};`,
			`const probe = ${JSON.stringify(printEnv("GIT_DIR", "GIT_INDEX_FILE", "GIT_SSH_COMMAND"))};`,
			"const r = await systemProcess.spawn([process.execPath, '-e', probe], { cwd: process.env.TMPDIR ?? '/tmp' });",
			"process.stdout.write(r.ok ? r.value.stdout : JSON.stringify(r.error));",
		].join("\n");
		const proc = Bun.spawn([BUN, "-e", host], {
			cwd: tmpdir(),
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				GIT_DIR: "/leaked/.git",
				GIT_INDEX_FILE: "/leaked/.git/index",
				GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
			},
		});
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		expect(stderr).toBe("");
		expect(stdout).toBe("undefined|undefined|ssh -o BatchMode=yes");
	});

	test("an explicit env is used exactly as given", async () => {
		const result = await systemProcess.spawn(
			[BUN, "-e", printEnv("MARK", "GIT_DIR")],
			{ cwd: tmpdir(), env: { MARK: "set", GIT_DIR: "/explicit/.git" } },
		);
		expect(result).toEqual({
			ok: true,
			value: { exitCode: 0, stdout: "set|/explicit/.git", stderr: "" },
		});
	});

	test("feeds stdin to the child when given", async () => {
		const result = await systemProcess.spawn(
			[BUN, "-e", "process.stdout.write(await Bun.stdin.text())"],
			{ cwd: tmpdir(), stdin: '{"event":"pre-commit"}' },
		);
		expect(result).toEqual({
			ok: true,
			value: { exitCode: 0, stdout: '{"event":"pre-commit"}', stderr: "" },
		});
	});

	test("a timed-out child that ignores SIGTERM is SIGKILLed after the grace period", async () => {
		const cwd = realpathSync(mkdtempSync(join(tmpdir(), "maina-kill-")));
		dirs.push(cwd);
		const pidFile = join(cwd, "pid");
		const stubborn = [
			"process.on('SIGTERM', () => {});",
			`require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
			"setInterval(() => {}, 1000);",
		].join(" ");
		const result = await createSystemProcess({ killGraceMs: 100 }).spawn(
			[BUN, "-e", stubborn],
			{ cwd, timeoutMs: 1000 },
		);
		expect(result).toEqual({
			ok: false,
			error: { kind: "timeout", timeoutMs: 1000 },
		});
		const pid = Number(await Bun.file(pidFile).text());
		const alive = (): boolean => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		};
		const deadline = Date.now() + 3000;
		while (alive() && Date.now() < deadline) await Bun.sleep(25);
		expect(alive()).toBe(false);
	});
});
