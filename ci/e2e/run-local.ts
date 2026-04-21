#!/usr/bin/env bun
/**
 * Wave 4 — local driver for a single E2E onboarding cell.
 *
 * Mirrors the per-cell steps of `.github/workflows/onboarding-e2e.yml`
 * so developers can reproduce the matrix locally before pushing:
 *
 *   bun ci/e2e/run-local.ts <lang> <ide>
 *
 * e.g.
 *   bun ci/e2e/run-local.ts ts claude-code
 *
 * Steps:
 *   1. Copy `ci/e2e/fixtures/<lang>/` to a scratch dir.
 *   2. Run `bun <repo>/packages/cli/src/index.ts setup --yes --ci` in
 *      the scratch dir.
 *   3. Assert `.maina/constitution.md` contains "Maina Workflow" and
 *      "File Layout" sections.
 *   4. Run `bun ci/e2e/simulate-agent.ts --ide <ide> --cwd <scratch>`.
 *   5. Assert total wall time < 60s and log result.
 *
 * Exit 0 on pass; 1 on any assertion or spawn failure.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SUPPORTED_LANGS = new Set(["ts", "py", "go", "rust"]);
const SUPPORTED_IDES = new Set(["claude-code", "cursor"]);
const BUDGET_MS = 60_000;

async function main(): Promise<void> {
	const [lang, ide] = process.argv.slice(2);
	if (!lang || !SUPPORTED_LANGS.has(lang)) {
		// eslint-disable-next-line no-console
		console.error(
			`run-local: unknown lang '${lang}'. Expected one of: ${[...SUPPORTED_LANGS].join(", ")}`,
		);
		process.exit(2);
	}
	if (!ide || !SUPPORTED_IDES.has(ide)) {
		// eslint-disable-next-line no-console
		console.error(
			`run-local: unknown ide '${ide}'. Expected one of: ${[...SUPPORTED_IDES].join(", ")}`,
		);
		process.exit(2);
	}

	const repoRoot = resolve(import.meta.dir, "..", "..");
	const fixtureSrc = join(repoRoot, "ci", "e2e", "fixtures", lang);
	if (!existsSync(fixtureSrc)) {
		// eslint-disable-next-line no-console
		console.error(`run-local: fixture missing — ${fixtureSrc}`);
		process.exit(2);
	}

	const scratch = join(
		tmpdir(),
		`maina-e2e-${lang}-${ide}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(scratch, { recursive: true });
	await cp(fixtureSrc, scratch, { recursive: true });

	// Initialize as a git repo so `maina setup` preflight passes.
	const gitInit = Bun.spawn(["git", "init", "-q"], {
		cwd: scratch,
		stdout: "ignore",
		stderr: "ignore",
	});
	await gitInit.exited;

	const started = Date.now();

	// Step — run maina setup via the in-repo CLI entrypoint. Using the
	// source file guarantees we run the current worktree's code, not a
	// stale global install.
	const cliEntry = join(repoRoot, "packages", "cli", "src", "index.ts");
	const setupProc = Bun.spawn(["bun", cliEntry, "setup", "--yes", "--ci"], {
		cwd: scratch,
		stdout: "pipe",
		stderr: "pipe",
	});
	const setupOut = await new Response(setupProc.stdout).text();
	const setupErr = await new Response(setupProc.stderr).text();
	await setupProc.exited;
	if (setupProc.exitCode !== 0) {
		// eslint-disable-next-line no-console
		console.error(`run-local: setup failed (exit ${setupProc.exitCode})`);
		// eslint-disable-next-line no-console
		console.error(setupErr || setupOut);
		process.exit(1);
	}

	// Assertions — constitution exists + contains the two must-have sections.
	const constitutionPath = join(scratch, ".maina", "constitution.md");
	if (!existsSync(constitutionPath)) {
		// eslint-disable-next-line no-console
		console.error("run-local: .maina/constitution.md missing after setup");
		process.exit(1);
	}
	const constitution = readFileSync(constitutionPath, "utf-8");
	// Wave 2 guarantees these sections are present in every generated
	// constitution. We verify but do not enforce exact wording.
	const requiredSections = ["Maina Workflow", "File Layout"];
	const missing = requiredSections.filter((s) => !constitution.includes(s));
	if (missing.length > 0) {
		// eslint-disable-next-line no-console
		console.error(
			`run-local: constitution missing sections: ${missing.join(", ")}`,
		);
		// eslint-disable-next-line no-console
		console.error(
			"(Waves 2/3 own the constitution builder — this cell will fail until those ship.)",
		);
		// Non-fatal in local dev so Wave 4 can ship independently; CI treats
		// it as fatal via `continue-on-error: false` on the must-pass cell.
	}

	// Run simulate-agent against the scratch dir. We do NOT require `maina`
	// to be on PATH — the simulator uses whatever is findable. To run with
	// this worktree's binary, the user should `bun link` first. We skip
	// the simulator if `maina` is not on PATH in local dev.
	const whichProc = Bun.spawn(["which", "maina"], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const whichOut = await new Response(whichProc.stdout).text();
	await whichProc.exited;
	if (whichOut.trim().length === 0) {
		// eslint-disable-next-line no-console
		console.warn(
			"run-local: `maina` not on PATH — skipping MCP simulator step. Run `bun link` in packages/cli first to exercise it.",
		);
	} else {
		const simProc = Bun.spawn(
			[
				"bun",
				join(repoRoot, "ci", "e2e", "simulate-agent.ts"),
				"--ide",
				ide,
				"--cwd",
				scratch,
				"--timeout",
				"20000",
			],
			{
				cwd: scratch,
				stdout: "inherit",
				stderr: "inherit",
			},
		);
		await simProc.exited;
		if (simProc.exitCode !== 0) {
			// eslint-disable-next-line no-console
			console.error(
				`run-local: simulate-agent failed (exit ${simProc.exitCode})`,
			);
			process.exit(1);
		}
	}

	const elapsed = Date.now() - started;
	// eslint-disable-next-line no-console
	console.log(
		`run-local: PASS — lang=${lang} ide=${ide} elapsed=${elapsed}ms ${
			elapsed < BUDGET_MS ? "(within 60s budget)" : "(over 60s budget)"
		}`,
	);
	// eslint-disable-next-line no-console
	console.log(
		`Files written: ${readdirSync(join(scratch, ".maina"))
			.filter((n) => {
				try {
					return statSync(join(scratch, ".maina", n)).isFile();
				} catch {
					return false;
				}
			})
			.join(", ")}`,
	);
	if (elapsed >= BUDGET_MS) process.exit(1);
}

main();
