#!/usr/bin/env bun
/**
 * Drives the escape and bypass suite (v1 task 4B.9, FR-SBX-5).
 *
 * For each worker (claude, codex, cursor, gemini, opencode) and each case
 * in `cases.ts` the runner builds a throwaway context — a factory-run
 * filesystem layout, that worker's gate integration installed so its files
 * are real targets (`installWorkerGate`: Claude's `PreToolUse` hook, or an
 * ACP worker's permission config pinned to asking), a forbidden local HTTP
 * server, and the ambient and masked secrets — then runs the case's attack
 * script two ways:
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
 *   bun ci/escape/runner.ts sandboxed --worker gemini   # one worker (default: all)
 *   bun ci/escape/runner.ts sandboxed --json <file>   # also write the run records
 *
 * In `sandboxed` mode a missing or wrong-version `srt` is a hard failure,
 * never a silent skip — unless `--allow-missing-sandbox` is passed, which is
 * only for the explicit unsandboxed control job.
 */

import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, type Result } from "../../packages/core/src/index";
import {
	installWorkerGate,
	uninstallWorkerGate,
} from "../../packages/harness/src/permissions/worker-gate";
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
import {
	resolveWorker,
	WORKER_NAMES,
} from "../../packages/harness/src/workers/registry";
import type { WorkerName } from "../../packages/harness/src/workers/spec";
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
/**
 * The workers to run the suite for: every supported one by default or for
 * `all`, else a comma-separated list (`--worker`, `MAINA_ESCAPE_WORKERS`).
 */
export function suiteWorkers(
	value: string | undefined,
): Result<
	readonly WorkerName[],
	Readonly<{ code: "unknown_worker"; message: string }>
> {
	const wanted = (value ?? "").trim();
	if (wanted === "" || wanted === "all")
		return { ok: true, value: WORKER_NAMES };
	const names = wanted.split(",").map((name) => name.trim());
	const unknown = names.filter(
		(name) => !(WORKER_NAMES as readonly string[]).includes(name),
	);
	if (unknown.length > 0) {
		return {
			ok: false,
			error: {
				code: "unknown_worker",
				message: `unknown worker(s) ${unknown.join(", ")}; supported: ${WORKER_NAMES.join(", ")} (or all)`,
			},
		};
	}
	return { ok: true, value: names as WorkerName[] };
}

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

/**
 * A fresh layout with `worker`'s gate integration installed, and the
 * sandbox that integration hands back. Exported for the tests, which build
 * it without the sandbox runtime.
 */
export function harnessFor(worker: WorkerName): Harness {
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

	// The worker's gate integration installed so prompt-injection cases have
	// real targets and the guarded sandbox denies writes to them. The agent
	// itself need not be installed: only its gate's files are attacked.
	const probe = {
		which: (binary: string) => Bun.which(binary) ?? `/usr/local/bin/${binary}`,
		version: () => null,
	};
	const spec = resolveWorker(worker, probe);
	if (!spec.ok) throw new Error(`resolveWorker: ${spec.error.message}`);
	const installed = installWorkerGate(spec.value, {
		worktree: layout.worktree,
		stateDir,
		policy: DEFAULT_POLICY,
		sandbox: base.value,
	});
	if (!installed.ok)
		throw new Error(`install ${worker} gate: ${installed.error.message}`);

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
		worker,
		layout,
		gateDir: installed.value.configDir,
		settingsPath: installed.value.configPath,
		policyPath: installed.value.policyPath,
		logPath: installed.value.logPath,
		settingsBefore: read(installed.value.configPath),
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
		uninstallWorkerGate(spec.value, layout.worktree);
		rmSync(layout.base, { recursive: true, force: true });
	};
	return { ctx, sandbox, dispose };
}

export type CaseResult = Readonly<{
	worker: WorkerName;
	id: string;
	category: EscapeCase["category"];
	title: string;
	mode: Mode;
	escaped: boolean;
	exitCode: number;
}>;

/**
 * Runs one case in one mode against its own fresh sandbox, with `worker`'s
 * gate integration installed. The ambient
 * secret is exported for the whole run so the sandbox's credential proxy has
 * something to strip and the unsandboxed control has something to leak.
 */
export async function runCase(
	esc: EscapeCase,
	mode: Mode,
	worker: WorkerName = "claude",
): Promise<CaseResult> {
	const previous = process.env[SECRET_ENV];
	process.env[SECRET_ENV] = SECRET_VALUE;
	const harness = harnessFor(worker);
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
			worker,
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

/** Runs every case (or a subset) in one mode for one worker, in order. */
async function runSuite(
	mode: Mode,
	worker: WorkerName,
	cases: readonly EscapeCase[] = ESCAPE_CASES,
): Promise<readonly CaseResult[]> {
	const results: CaseResult[] = [];
	for (const esc of cases) {
		results.push(await runCase(esc, mode, worker));
	}
	return results;
}

/**
 * One run of the suite as the release evidence reads it (spec §9.6,
 * `scripts/release/evidence/escape.ts`): per OS and worker, how many cases
 * ran and how many the sandbox blocked.
 */
export function runRecord(
	mode: Mode,
	results: readonly CaseResult[],
	platform: string,
	worker: string,
): Readonly<{
	os: string;
	worker: string;
	mode: Mode;
	cases: number;
	blocked: number;
	escaped: readonly string[];
}> {
	const escaped = results.filter((r) => r.escaped).map((r) => r.id);
	return {
		os: platform === "darwin" ? "macos" : platform,
		worker,
		mode,
		cases: results.length,
		blocked: results.length - escaped.length,
		escaped,
	};
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
	const flagValue = (flag: string): string | undefined => {
		const at = args.indexOf(flag);
		return at >= 0 ? args[at + 1] : undefined;
	};
	const jsonFile = flagValue("--json");
	if (mode === undefined) {
		process.stderr.write(
			"usage: runner.ts <sandboxed|unsandboxed> [--worker <name,...|all>] [--allow-missing-sandbox] [--json <file>]\n",
		);
		process.exit(2);
	}
	const workers = suiteWorkers(
		flagValue("--worker") ?? process.env.MAINA_ESCAPE_WORKERS,
	);
	if (!workers.ok) {
		process.stderr.write(`${workers.error.message}\n`);
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

	// One run per worker, each against that worker's gate integration.
	const runs: { worker: WorkerName; results: readonly CaseResult[] }[] = [];
	for (const worker of workers.value) {
		runs.push({ worker, results: await runSuite(mode, worker) });
	}
	if (jsonFile !== undefined) {
		const { writeFileSync } = await import("node:fs");
		const records = runs.map((r) =>
			runRecord(mode, r.results, process.platform, r.worker),
		);
		writeFileSync(jsonFile, `${JSON.stringify(records, null, "\t")}\n`);
	}
	const results = runs.flatMap((r) => r.results);
	const bad = results.filter((r) => !wanted(mode, r.escaped));
	for (const r of results) {
		const ok = wanted(mode, r.escaped);
		process.stdout.write(
			`${ok ? "PASS" : "FAIL"}  ${r.worker.padEnd(9)} ${r.category.padEnd(20)} ${r.id.padEnd(28)} ` +
				`${r.escaped ? "escaped" : "blocked"}\n`,
		);
	}
	process.stdout.write(
		`\n${JSON.stringify({
			mode,
			workers: runs.map((r) => r.worker),
			total: results.length,
			failed: bad.length,
		})}\n`,
	);
	if (bad.length > 0) {
		process.stderr.write(
			`\n${bad.length} case(s) did not ${mode === "unsandboxed" ? "escape unsandboxed" : "get blocked"}:\n` +
				bad.map((r) => `  - ${r.worker} · ${r.id}`).join("\n") +
				"\n",
		);
		process.exit(1);
	}
}

if (import.meta.main) {
	await main();
}
