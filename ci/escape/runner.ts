#!/usr/bin/env bun
/**
 * Drives the escape and bypass suite (v1 task 4B.9, FR-SBX-5).
 *
 * For each case in `cases.ts` the runner builds a throwaway context — a
 * factory-run filesystem layout, the Claude gate hook installed so its
 * files are real targets, a forbidden local HTTP server, and the ambient
 * and masked secrets — then runs the case's attack script two ways:
 *
 *   - unsandboxed: the raw command, as an unprotected worker would run it.
 *     Every case must ESCAPE here, or the case has no teeth (Step 2).
 *   - sandboxed:   the command wrapped by the real `srt` adapter. Every
 *     case must be BLOCKED here (Step 3).
 *
 * As a CLI it runs one mode and prints a table plus JSON:
 *
 *   bun ci/escape/runner.ts unsandboxed   # expect: all escape
 *   bun ci/escape/runner.ts sandboxed     # expect: none escape
 *
 * In `sandboxed` mode a missing or wrong-version `srt` is a hard failure,
 * never a silent skip — unless `--allow-missing-sandbox` is passed, which is
 * only for the explicit unsandboxed control job.
 */

import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY } from "../../packages/core/src/index";
import {
	installClaudePreToolUse,
	uninstallClaudePreToolUse,
} from "../../packages/harness/src/permissions/claude-sdk-hook";
import {
	makeLayout,
	run,
	shell,
} from "../../packages/harness/src/sandbox/__tests__/sandbox-fixture";
import { policyToSandbox } from "../../packages/harness/src/sandbox/policy-to-sandbox";
import type {
	Credential,
	SandboxOptions,
} from "../../packages/harness/src/sandbox/port";
import {
	createSandboxRuntime,
	detectSandboxRuntime,
} from "../../packages/harness/src/sandbox/runtime-adapter";
import { resolveWorker } from "../../packages/harness/src/workers/registry";
import {
	ESCAPE_CASES,
	type EscapeCase,
	type EscapeContext,
	type EscapeOutcome,
} from "./cases";

export type Mode = "sandboxed" | "unsandboxed";

const MARKER = "SERVER-MARKER-322";
const ALLOWED_HOST = "allowed.example.test";
const SECRET_ENV = "GITHUB_TOKEN";
const SECRET_VALUE = "ghp_ambient_escape_322";
const CRED_ENV = "ANTHROPIC_API_KEY";
const CRED_VALUE = "sk-ant-real-escape-322";
const RUN_MS = 20_000;

/** A per-case sandbox setup, disposed after the case runs. */
type Harness = Readonly<{
	ctx: EscapeContext;
	sandbox: SandboxOptions;
	dispose: () => void;
}>;

/** Serves the marker for any request; the forbidden host every net case hits. */
function startServer() {
	return Bun.serve({
		hostname: "::",
		port: 0,
		fetch: () => new Response(MARKER),
	});
}

function buildHarness(): Harness {
	const layout = makeLayout();
	const stateDir = join(layout.worktreesRoot, ".maina-state");
	const server = startServer();
	const serverPort = server.port ?? 0;

	const base = policyToSandbox(
		DEFAULT_POLICY,
		layout.worktree,
		layout.holdout,
		{
			home: layout.home,
			worktreesRoot: layout.worktreesRoot,
			tmpDir: layout.tmp,
		},
	);
	if (!base.ok) throw new Error(`policyToSandbox: ${base.error.message}`);

	// The gate hook installed so prompt-injection cases have real targets and
	// the guarded sandbox denies writes to them.
	const probe = {
		which: (binary: string) => Bun.which(binary) ?? `/usr/local/bin/${binary}`,
		version: () => null,
	};
	const claude = resolveWorker("claude", probe);
	if (!claude.ok) throw new Error(`resolveWorker: ${claude.error.message}`);
	const installed = installClaudePreToolUse(claude.value, {
		worktree: layout.worktree,
		stateDir,
		policy: DEFAULT_POLICY,
		sandbox: base.value,
	});
	if (!installed.ok)
		throw new Error(`install hook: ${installed.error.message}`);

	const credential: Credential = {
		name: CRED_ENV,
		value: CRED_VALUE,
		hosts: [ALLOWED_HOST],
	};
	const sandbox: SandboxOptions = {
		...installed.value.sandbox,
		netAllow: [...installed.value.sandbox.netAllow, ALLOWED_HOST],
		credentials: [credential],
	};

	const read = (path: string): string => {
		try {
			return readFileSync(path, "utf8");
		} catch {
			return "";
		}
	};
	const ctx: EscapeContext = {
		layout,
		settingsPath: installed.value.settingsPath,
		policyPath: installed.value.policyPath,
		logPath: installed.value.logPath,
		settingsBefore: read(installed.value.settingsPath),
		policyBefore: read(installed.value.policyPath),
		server: { host: "127.0.0.1", port: serverPort, marker: MARKER },
		allowedHost: ALLOWED_HOST,
		secretEnvName: SECRET_ENV,
		secretEnvValue: SECRET_VALUE,
		maskedCredName: CRED_ENV,
		maskedCredValue: CRED_VALUE,
		homeSecretMarker: read(join(layout.home, ".ssh", "id_rsa")).trim(),
		otherWorktreeMarker: read(join(layout.otherWorktree, "notes.txt")).trim(),
		holdoutMarker: read(join(layout.holdout, "answers.txt")).trim(),
	};

	const dispose = () => {
		server.stop(true);
		uninstallClaudePreToolUse(layout.worktree);
		rmSync(layout.base, { recursive: true, force: true });
	};
	return { ctx, sandbox, dispose };
}

export type CaseResult = Readonly<{
	id: string;
	category: EscapeCase["category"];
	title: string;
	mode: Mode;
	escaped: boolean;
	exitCode: number;
}>;

/**
 * Runs one case in one mode against its own fresh sandbox. The ambient
 * secret is exported for the whole run so the sandbox's credential proxy has
 * something to strip and the unsandboxed control has something to leak.
 */
export async function runCase(
	esc: EscapeCase,
	mode: Mode,
): Promise<CaseResult> {
	const previous = process.env[SECRET_ENV];
	process.env[SECRET_ENV] = SECRET_VALUE;
	const harness = buildHarness();
	try {
		const command = shell(esc.script(harness.ctx));
		let outcome: EscapeOutcome;
		if (mode === "unsandboxed") {
			outcome = await run(command, harness.ctx.layout.worktree, {
				...process.env,
				[SECRET_ENV]: SECRET_VALUE,
				[CRED_ENV]: CRED_VALUE,
			});
		} else {
			const wrapped = createSandboxRuntime().wrap(command, harness.sandbox);
			if (!wrapped.ok) throw new Error(`wrap: ${wrapped.error.message}`);
			outcome = await run(wrapped.value, harness.ctx.layout.worktree);
		}
		return {
			id: esc.id,
			category: esc.category,
			title: esc.title,
			mode,
			escaped: esc.escaped(outcome, harness.ctx),
			exitCode: outcome.exitCode,
		};
	} finally {
		harness.dispose();
		if (previous === undefined) delete process.env[SECRET_ENV];
		else process.env[SECRET_ENV] = previous;
	}
}

/** Runs every case (or a subset) in one mode, in order. */
export async function runSuite(
	mode: Mode,
	cases: readonly EscapeCase[] = ESCAPE_CASES,
): Promise<readonly CaseResult[]> {
	const results: CaseResult[] = [];
	for (const esc of cases) {
		results.push(await runCase(esc, mode));
	}
	return results;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/** In `mode`, is `escaped` the outcome we want? */
export const wanted = (mode: Mode, escaped: boolean): boolean =>
	mode === "unsandboxed" ? escaped : !escaped;

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const mode = args.find((a) => a === "sandboxed" || a === "unsandboxed") as
		| Mode
		| undefined;
	const allowMissing = args.includes("--allow-missing-sandbox");
	if (mode === undefined) {
		process.stderr.write(
			"usage: runner.ts <sandboxed|unsandboxed> [--allow-missing-sandbox]\n",
		);
		process.exit(2);
	}

	if (mode === "sandboxed") {
		const detected = detectSandboxRuntime();
		if (!detected.ok && !allowMissing) {
			process.stderr.write(
				`sandbox runtime unavailable: ${detected.error.message}` +
					`${detected.error.hint ? ` (${detected.error.hint})` : ""}\n` +
					"the sandboxed escape suite cannot run; failing loudly.\n",
			);
			process.exit(1);
		}
	}

	const results = await runSuite(mode);
	const bad = results.filter((r) => !wanted(mode, r.escaped));
	for (const r of results) {
		const ok = wanted(mode, r.escaped);
		process.stdout.write(
			`${ok ? "PASS" : "FAIL"}  ${r.category.padEnd(20)} ${r.id.padEnd(28)} ` +
				`${r.escaped ? "escaped" : "blocked"}\n`,
		);
	}
	process.stdout.write(
		`\n${JSON.stringify({ mode, total: results.length, failed: bad.length })}\n`,
	);
	if (bad.length > 0) {
		process.stderr.write(
			`\n${bad.length} case(s) did not ${mode === "unsandboxed" ? "escape unsandboxed" : "get blocked"}:\n` +
				bad.map((r) => `  - ${r.id}`).join("\n") +
				"\n",
		);
		process.exit(1);
	}
}

if (import.meta.main) {
	await main();
}
