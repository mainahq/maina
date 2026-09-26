/**
 * Shared by the sandbox integration tests: whether a real `srt` can run on
 * this machine, a throwaway filesystem layout that looks like a factory run,
 * and a way to run a wrapped command and see what happened.
 *
 * Without the pinned sandbox runtime the integration tests are skipped and
 * say why; `MAINA_REQUIRE_SANDBOX=1` (the `sandbox` CI job) turns the skip
 * into a failure so a broken install cannot pass for a green run.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "../port";
import { detectSandboxRuntime } from "../runtime-adapter";

const detected = detectSandboxRuntime();

/** Why the integration tests cannot run here, or undefined when they can. */
export const SKIP_REASON: string | undefined = detected.ok
	? undefined
	: `${detected.error.message}${detected.error.hint ? ` (${detected.error.hint})` : ""}`;

export const REQUIRE_SANDBOX = process.env.MAINA_REQUIRE_SANDBOX === "1";

// bun does not list skipped tests, so the reason is printed where it shows.
if (SKIP_REASON !== undefined && !REQUIRE_SANDBOX) {
	process.stderr.write(`[sandbox] integration tests skipped: ${SKIP_REASON}\n`);
}

/** A describe title that carries the skip reason when there is one. */
export const integrationTitle = (title: string): string =>
	SKIP_REASON === undefined ? title : `${title} [skipped: ${SKIP_REASON}]`;

/**
 * A factory run's layout under one temp directory:
 *
 *   home/.ssh/id_rsa           a secret in a fake home
 *   worktrees/run-1/           this worker's worktree
 *   worktrees/run-2/notes.txt  another worker's worktree
 *   holdout/answers.txt        the hidden holdout tests
 *   outside/                   anywhere else on disk
 *   tmp/                       this worker's temp directory
 */
export type Layout = Readonly<{
	base: string;
	home: string;
	worktreesRoot: string;
	worktree: string;
	otherWorktree: string;
	holdout: string;
	outside: string;
	tmp: string;
}>;

export function makeLayout(): Layout {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "maina-sbx-")));
	const layout: Layout = {
		base,
		home: join(base, "home"),
		worktreesRoot: join(base, "worktrees"),
		worktree: join(base, "worktrees", "run-1"),
		otherWorktree: join(base, "worktrees", "run-2"),
		holdout: join(base, "holdout"),
		outside: join(base, "outside"),
		tmp: join(base, "tmp"),
	};
	for (const dir of [
		join(layout.home, ".ssh"),
		layout.worktree,
		layout.otherWorktree,
		layout.holdout,
		layout.outside,
		layout.tmp,
	]) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(join(layout.home, ".ssh", "id_rsa"), "PRIVATE-KEY-316\n");
	writeFileSync(join(layout.worktree, "README.md"), "own worktree\n");
	writeFileSync(join(layout.otherWorktree, "notes.txt"), "OTHER-RUN-316\n");
	writeFileSync(join(layout.holdout, "answers.txt"), "HOLDOUT-316\n");
	return layout;
}

type Ran = Readonly<{
	exitCode: number;
	stdout: string;
	stderr: string;
}>;

/** Runs a wrapped command the way `spawnAgent` does: inherited env plus its own. */
export async function run(
	command: Command,
	cwd: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Ran> {
	const child = Bun.spawn([command.command, ...(command.args ?? [])], {
		cwd,
		env: { ...env, ...command.env },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, stdout, stderr };
}

/** `sh -c <script>` as a command to wrap. */
export const shell = (script: string): Command => ({
	name: "sh",
	command: "/bin/sh",
	args: ["-c", script],
});
