/**
 * W1: install.sh emits well-known exit codes and a copy-pasteable PATH hint.
 *
 * Runs install.sh with a crafted PATH containing a fake `bun` that we control,
 * then asserts the exit code and stderr/stdout contents. No Docker required.
 *
 * Exit codes:
 *   10 — no package manager found
 *   11 — install command failed
 *   12 — install succeeded but `maina` is not on PATH
 *   0  — `maina` is on PATH
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const INSTALL_SH = resolve(import.meta.dir, "../../../..", "install.sh");

function makeTmpBinDir(): string {
	const dir = join(
		tmpdir(),
		`maina-install-bin-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Write an executable stub to `dir/name` that runs `script` via bash.
 */
function writeStub(dir: string, name: string, script: string): void {
	const path = join(dir, name);
	writeFileSync(path, `#!/bin/bash\n${script}\n`);
	chmodSync(path, 0o755);
}

async function runInstallSh(
	pathOverride: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn({
		cmd: ["bash", INSTALL_SH],
		env: {
			PATH: pathOverride,
			HOME: process.env.HOME ?? "/tmp",
			SHELL: "/bin/bash",
			CI: "1",
		},
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { exitCode, stdout, stderr };
}

let binDir: string;

beforeEach(() => {
	binDir = makeTmpBinDir();
});

afterEach(() => {
	rmSync(binDir, { recursive: true, force: true });
});

describe("install.sh — exit codes", () => {
	test("exists at repo root", () => {
		expect(existsSync(INSTALL_SH)).toBe(true);
	});

	test("exit 10 when no package manager is found", async () => {
		// PATH has nothing — no bun, npm, pnpm, yarn, no maina, no claude, etc.
		// But we need `bash`, `grep`, `uname`, `mkdir`, `echo` — use a minimal
		// path that includes /bin and /usr/bin only, no node-ish tools. On macOS
		// those aren't in /bin either, so assemble a tiny dir with just coreutils
		// shims by using the system path stripped of typical node installs. Since
		// we can't cleanly isolate, we skip this test when a package manager is
		// on the default $PATH.
		const system = "/usr/bin:/bin";
		const { exitCode, stdout, stderr } = await runInstallSh(system);
		// On hosts where bun/npm/pnpm/yarn are installed in /usr/bin (rare), this
		// test will not produce exit 10. Guard with an early return in that case.
		const hasPm = /Package manager: (bun|pnpm|yarn|npm)/.test(stdout + stderr);
		if (hasPm) return;
		expect(exitCode).toBe(10);
	});

	test("exit 11 when bun install fails", async () => {
		// Fake bun that fails on `install -g`
		writeStub(
			binDir,
			"bun",
			'if [ "$1" = "install" ] && [ "$2" = "-g" ]; then\n  echo "bun install failed (mock)" >&2\n  exit 1\nfi\necho "1.0.0"',
		);
		const { exitCode, stdout, stderr } = await runInstallSh(
			`${binDir}:/usr/bin:/bin`,
		);
		expect(exitCode).toBe(11);
		expect(stdout + stderr).toContain("npm install -g");
	});

	test("exit 12 when install succeeds but maina is not on PATH", async () => {
		// Fake bun that "succeeds" on install -g but does not put maina anywhere
		writeStub(binDir, "bun", "exit 0");
		const { exitCode, stdout, stderr } = await runInstallSh(
			`${binDir}:/usr/bin:/bin`,
		);
		expect(exitCode).toBe(12);
		const combined = stdout + stderr;
		// Must include either the zsh, bash, or fish profile hint
		expect(combined).toMatch(/\.zshrc|\.bashrc|config\.fish|shell profile/);
		// Must include the PATH export hint
		expect(combined).toMatch(/bun\/bin/);
	});

	test("no silent bunx fallback when install succeeds but PATH missing", async () => {
		writeStub(binDir, "bun", "exit 0");
		writeStub(binDir, "bunx", 'echo "1.0.0"');
		const { exitCode, stdout } = await runInstallSh(`${binDir}:/usr/bin:/bin`);
		expect(exitCode).toBe(12);
		// The old behaviour announced "available via bunx" — must be gone.
		expect(stdout).not.toContain("available via bunx");
	});
});
