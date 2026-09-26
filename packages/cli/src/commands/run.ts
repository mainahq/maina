/**
 * `maina run` (FR-HAR-4, FR-HAR-5, FR-SBX-6): runs a coding agent on a task
 * in its own worktree, inside maina's OS sandbox, gated by the policy for
 * the run's context, bounded by the context's budgets and by one revision.
 *
 * `runAction` is the testable core: it resolves the context and budgets,
 * has `prepare` set the run up (worker, worktree, sandbox, gate) and hands
 * the result to the harness's revision loop, then writes the receipt to
 * `.maina/runs/<run id>.json`. Everything with side effects is a dep.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import {
	DEFAULT_REGISTRY,
	type EnvPort,
	type FsPort,
	holdoutDir,
	loadPolicy,
	loadShellParser,
	type Policy,
	type PolicyError,
	type Result,
	type RunContext,
	readUserPolicy,
	runPipeline,
	systemProcess,
} from "@mainahq/core";
import { acpGatePolicy } from "@mainahq/harness/src/permissions/acp-bridge";
import type {
	GateBridge,
	PermissionRecord,
} from "@mainahq/harness/src/permissions/judge";
import { budgetsFor } from "@mainahq/harness/src/run/budget";
import { resolveRunContext, runEnv } from "@mainahq/harness/src/run/context";
import {
	orchestratedAttempt,
	type Review,
	type RevisionPorts,
	type RunReceipt,
	runWithRevision,
} from "@mainahq/harness/src/run/revision";
import { configureInnerSandbox } from "@mainahq/harness/src/sandbox/nested";
import { policyToSandbox } from "@mainahq/harness/src/sandbox/policy-to-sandbox";
import type { Credential } from "@mainahq/harness/src/sandbox/port";
import {
	createSandboxRuntime,
	detectSandboxRuntime,
} from "@mainahq/harness/src/sandbox/runtime-adapter";
import { cleanup } from "@mainahq/harness/src/sessions/cleanup";
import {
	createWorktree,
	type Worktree,
} from "@mainahq/harness/src/sessions/worktree";
import { resolveWorker } from "@mainahq/harness/src/workers/registry";
import { Command } from "commander";
import { processEnv } from "../env";
import { nodeFs } from "../ports";

// ── Types ────────────────────────────────────────────────────────────────────

export type RunActionOptions = Readonly<{
	task: string;
	/** Worker name, as `resolveWorker` takes it: `claude`, `codex`, ... */
	agent: string;
	cwd: string;
	/** `--interactive` / `--unattended`; resolved from the terminal otherwise. */
	context?: RunContext;
	/** Open a PR when the review passes. */
	pr?: boolean;
}>;

export type PrepareInput = Readonly<{
	root: string;
	runId: string;
	task: string;
	agent: string;
	policy: Policy;
	context: RunContext;
	pr: boolean;
}>;

export type PreparedRun = Readonly<{
	worktree: Readonly<{ path: string; branch: string }>;
	ports: RevisionPorts;
}>;

type Failure = Readonly<{ message: string; hint?: string }>;

type RunError = Readonly<{
	kind: "root" | "policy" | "prepare" | "io";
	message: string;
	hint?: string;
}>;

export type RunActionDeps = Readonly<{
	/** stdin and stdout are a terminal. */
	interactiveTerminal: boolean;
	env: EnvPort;
	repoRoot: (cwd: string) => Promise<Result<string, Failure>>;
	loadPolicy: (root: string) => Promise<Result<Policy, readonly PolicyError[]>>;
	newRunId: () => string;
	prepare: (input: PrepareInput) => Promise<Result<PreparedRun, Failure>>;
	writeFile: FsPort["writeFile"];
}>;

type RunActionResult =
	| Readonly<{
			ok: true;
			runId: string;
			receipt: RunReceipt;
			receiptPath: string;
			worktree: PreparedRun["worktree"];
	  }>
	| Readonly<{ ok: false; error: RunError }>;

// ── Core action ──────────────────────────────────────────────────────────────

const describePolicyErrors = (errors: readonly PolicyError[]): string =>
	errors
		.map(
			(e) => `${e.file ?? e.source}${e.path ? ` ${e.path}` : ""}: ${e.message}`,
		)
		.join("\n");

export async function runAction(
	options: RunActionOptions,
	deps: RunActionDeps,
): Promise<RunActionResult> {
	const root = await deps.repoRoot(options.cwd);
	if (!root.ok) return { ok: false, error: { kind: "root", ...root.error } };
	const policy = await deps.loadPolicy(root.value);
	if (!policy.ok) {
		return {
			ok: false,
			error: { kind: "policy", message: describePolicyErrors(policy.error) },
		};
	}

	const context = resolveRunContext({
		requested: options.context,
		interactiveTerminal: deps.interactiveTerminal,
		ci: Boolean(deps.env.get("CI")),
	});
	const budgets = budgetsFor(policy.value, context);
	const runId = deps.newRunId();
	const prepared = await deps.prepare({
		root: root.value,
		runId,
		task: options.task,
		agent: options.agent,
		policy: policy.value,
		context,
		pr: options.pr === true,
	});
	if (!prepared.ok) {
		return { ok: false, error: { kind: "prepare", ...prepared.error } };
	}

	const { worktree, ports } = prepared.value;
	const receipt = await runWithRevision(
		{ task: options.task, context, budgets },
		ports,
	);
	const receiptPath = join(root.value, ".maina", "runs", `${runId}.json`);
	const written = await deps.writeFile(
		receiptPath,
		`${JSON.stringify(
			{
				runId,
				task: options.task,
				agent: options.agent,
				worktree: worktree.path,
				branch: worktree.branch,
				...receipt,
			},
			null,
			2,
		)}\n`,
	);
	if (!written.ok) {
		return {
			ok: false,
			error: {
				kind: "io",
				message: `the run ended (${receipt.status}) but its receipt could not be written to ${receiptPath}`,
			},
		};
	}
	return { ok: true, runId, receipt, receiptPath, worktree };
}

// ── Default dependencies ─────────────────────────────────────────────────────

type Spawned = Readonly<{ code: number; stdout: string; stderr: string }>;

async function spawn(
	argv: readonly string[],
	cwd: string,
): Promise<Result<Spawned, Failure>> {
	try {
		const proc = Bun.spawn([...argv], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { ok: true, value: { code, stdout: stdout.trim(), stderr } };
	} catch (e) {
		return {
			ok: false,
			error: {
				message: `${argv[0]}: ${e instanceof Error ? e.message : String(e)}`,
			},
		};
	}
}

async function run(
	argv: readonly string[],
	cwd: string,
): Promise<Result<string, Failure>> {
	const result = await spawn(argv, cwd);
	if (!result.ok) return result;
	return result.value.code === 0
		? { ok: true, value: result.value.stdout }
		: {
				ok: false,
				error: {
					message: `${argv.join(" ")} failed: ${result.value.stderr.trim()}`,
				},
			};
}

/**
 * The model keys each agent reads, and the only hosts the real key goes to.
 * The worker sees a stand-in; the sandbox swaps the key in on the way out.
 */
const WORKER_CREDENTIALS: Readonly<
	Record<string, ReadonlyArray<Readonly<{ name: string; hosts: string[] }>>>
> = {
	claude: [{ name: "ANTHROPIC_API_KEY", hosts: ["api.anthropic.com"] }],
	codex: [{ name: "OPENAI_API_KEY", hosts: ["api.openai.com"] }],
	gemini: [
		{ name: "GEMINI_API_KEY", hosts: ["generativelanguage.googleapis.com"] },
	],
};

function credentialsFor(agent: string, env: EnvPort): Credential[] {
	return (WORKER_CREDENTIALS[agent] ?? []).flatMap(({ name, hosts }) => {
		const value = env.get(name);
		return value ? [{ name, value, hosts }] : [];
	});
}

/** `maina verify` on the run's changes; one line per finding. */
async function reviewWorktree(worktree: Worktree): Promise<Review> {
	const result = await runPipeline({
		cwd: worktree.path,
		mainaDir: join(worktree.path, ".maina"),
		baseBranch: worktree.baseSha,
		scope: "working-tree",
		diffOnly: true,
		env: process.env,
		process: systemProcess,
	});
	return {
		passed: result.passed,
		findings: result.findings.map(
			(f) => `${f.tool} ${f.file}:${f.line} ${f.severity}: ${f.message}`,
		),
	};
}

/** Commits the run's work on its branch, pushes it and opens a PR with gh. */
function prOpener(
	worktree: Worktree,
	task: string,
): NonNullable<RevisionPorts["openPr"]> {
	const title = task.split("\n")[0]?.slice(0, 72) || "maina run";
	return async () => {
		for (const argv of [
			["git", "add", "-A"],
			["git", "commit", "-m", title],
			["git", "push", "-u", "origin", worktree.branch],
		]) {
			const step = await run(argv, worktree.path);
			if (!step.ok) return step;
		}
		return run(
			["gh", "pr", "create", "--fill", "--head", worktree.branch],
			worktree.path,
		);
	};
}

/** Appends each permission record to `file`; the bridge ignores a failure. */
function permissionLog(file: string): GateBridge["log"] {
	mkdirSync(dirname(file), { recursive: true });
	return (record: PermissionRecord) => {
		appendFileSync(file, `${JSON.stringify(record)}\n`);
	};
}

type GateBridgeInput = Readonly<{
	policy: Policy;
	context: RunContext;
	/** Where each permission record is appended, one JSON line each. */
	logFile: string;
	/** The branch the agent works on, for the gate's branch rules. */
	currentBranch?: string;
}>;

/** The real gate (rules backends, bash grammar) with a JSONL permission log. */
export async function createGateBridge(
	input: GateBridgeInput,
): Promise<GateBridge> {
	const shell = await loadShellParser();
	return {
		ports: {
			clock: { now: () => performance.now() },
			backends: DEFAULT_REGISTRY,
			ctx: {
				shell: shell.ok ? shell.value : null,
				home: homedir(),
				...(input.currentBranch === undefined
					? {}
					: { currentBranch: input.currentBranch }),
			},
			newId: randomUUID,
		},
		policy: input.policy,
		log: permissionLog(input.logFile),
		context: input.context,
	};
}

/**
 * The real setup: resolve the worker, give it a worktree, wrap its launch
 * in the OS sandbox (a run never starts unsandboxed), and gate its
 * permission requests by the policy for the run's context.
 */
async function prepareRun(
	input: PrepareInput,
): Promise<Result<PreparedRun, Failure>> {
	const worker = resolveWorker(input.agent);
	if (!worker.ok) return worker;
	if (worker.value.protocol !== "acp") {
		return {
			ok: false,
			error: {
				message: `maina run drives agents over ACP; ${worker.value.name} is a headless worker`,
			},
		};
	}
	const { worker: configured } = configureInnerSandbox(worker.value);
	// No sandbox, no run: check before a worktree is made for nothing.
	const runtime = detectSandboxRuntime();
	if (!runtime.ok) return runtime;

	const created = await createWorktree(input.root, input.runId);
	if (!created.ok) return created;
	const worktree = created.value;
	const abandon = async (error: Failure): Promise<Result<never, Failure>> => {
		await cleanup(input.runId, { root: input.root });
		return { ok: false, error };
	};

	const options = policyToSandbox(
		input.policy,
		worktree.path,
		holdoutDir(input.root),
	);
	if (!options.ok) return abandon(options.error);
	const launch = {
		...configured.launch,
		env: { ...configured.launch.env, ...runEnv(input.runId) },
	};
	const sandboxed = createSandboxRuntime().wrap(launch, {
		...options.value,
		credentials: credentialsFor(input.agent, processEnv),
	});
	if (!sandboxed.ok) return abandon(sandboxed.error);

	const bridge = await createGateBridge({
		policy: input.policy,
		context: input.context,
		logFile: join(
			input.root,
			".maina",
			"runs",
			`${input.runId}.permissions.jsonl`,
		),
		currentBranch: worktree.branch,
	});

	return {
		ok: true,
		value: {
			worktree: { path: worktree.path, branch: worktree.branch },
			ports: {
				attempt: orchestratedAttempt({
					agent: sandboxed.value,
					root: worktree.path,
					policy: acpGatePolicy(bridge),
				}),
				review: () => reviewWorktree(worktree),
				...(input.pr ? { openPr: prOpener(worktree, input.task) } : {}),
				now: () => Date.now(),
			},
		},
	};
}

/** The repo's policy, layered over the user's. */
export async function loadRunPolicy(
	root: string,
): Promise<Result<Policy, readonly PolicyError[]>> {
	const user = await readUserPolicy({ fs: nodeFs }, homedir());
	if (!user.ok) return user;
	return loadPolicy({ fs: nodeFs }, root, user.value);
}

/** Built when the command runs: reading `process.stdin` has side effects. */
const defaultDeps = (): RunActionDeps => ({
	interactiveTerminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
	env: processEnv,
	repoRoot: (cwd) => run(["git", "rev-parse", "--show-toplevel"], cwd),
	loadPolicy: loadRunPolicy,
	newRunId: () => `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
	prepare: prepareRun,
	writeFile: nodeFs.writeFile,
});

// ── Commander command ────────────────────────────────────────────────────────

type RunFlags = Readonly<{
	agent: string;
	unattended?: boolean;
	interactive?: boolean;
	pr?: boolean;
	json?: boolean;
}>;

export function runCommand(): Command {
	return new Command("run")
		.description(
			"Run an agent on a task in maina's sandbox, gated, budgeted and reviewed",
		)
		.argument("<task...>", "What the agent should do")
		.option(
			"--agent <name>",
			"Worker: claude, codex, cursor, gemini, opencode",
			"claude",
		)
		.option("--unattended", "Nobody will answer: every ask is denied")
		.option("--interactive", "Someone is at the terminal")
		.option("--pr", "Open a PR when the review passes")
		.option("--json", "Print the receipt as JSON")
		.action(async (words: string[], flags: RunFlags) => {
			const context: RunContext | undefined = flags.unattended
				? "unattended"
				: flags.interactive
					? "interactive"
					: undefined;
			if (!flags.json) intro("maina run");
			const result = await runAction(
				{
					task: words.join(" "),
					agent: flags.agent,
					cwd: process.cwd(),
					...(context === undefined ? {} : { context }),
					pr: flags.pr === true,
				},
				defaultDeps(),
			);
			if (!result.ok) {
				if (flags.json) {
					process.stdout.write(`${JSON.stringify({ error: result.error })}\n`);
				} else {
					log.error(result.error.message);
					if (result.error.hint) log.info(result.error.hint);
					outro("maina run did not start.");
				}
				process.exitCode = 1;
				return;
			}
			const { receipt } = result;
			if (flags.json) {
				process.stdout.write(
					`${JSON.stringify({ runId: result.runId, ...receipt })}\n`,
				);
			} else {
				const report = receipt.status === "passed" ? log.success : log.warning;
				report(receipt.report);
				log.info(
					`Worktree: ${result.worktree.path} (${result.worktree.branch})`,
				);
				outro(`Receipt: ${result.receiptPath}`);
			}
			process.exitCode = receipt.status === "passed" ? 0 : 1;
		});
}
