/**
 * `maina acp --agent <name>` (FR-HAR-3): ACP proxy mode for editors.
 *
 * Zed, JetBrains IDEs and any other ACP client launch this command as
 * their agent. maina launches the real agent (`claude-agent-acp`,
 * `codex-acp`, ...) and passes every message between the two unchanged,
 * except the agent's permission requests: the gate answers them first,
 * denying what the policy denies and allowing what it allows, and passes
 * only an `ask` on to the person in the editor. What the agent asks the
 * editor to run, write or read for it is judged too, and a deny refused.
 * When the editor or the agent goes away, the other is cleaned up and a
 * receipt of the session is written to `.maina/runs/acp-<id>.json`.
 *
 * stdout carries the protocol: everything else goes to stderr.
 *
 * `acpAction` is the testable core; everything with side effects is a dep.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
	FsPort,
	Policy,
	PolicyError,
	Result,
	RunContext,
} from "@mainahq/core";
import type { HarnessError } from "@mainahq/harness/src/events";
import type { GateBridge } from "@mainahq/harness/src/permissions/judge";
import {
	type ProxyReceipt,
	startProxy,
} from "@mainahq/harness/src/proxy/server";
import type { AgentSpec } from "@mainahq/harness/src/worker";
import {
	resolveWorker,
	type WorkerSpec,
} from "@mainahq/harness/src/workers/registry";
import type { WorkerError } from "@mainahq/harness/src/workers/spec";
import { Command } from "commander";
import { nodeFs } from "../ports";
import { createGateBridge, loadRunPolicy } from "./run";

// ── Types ────────────────────────────────────────────────────────────────────

type AcpActionOptions = Readonly<{
	/** Worker name, as `resolveWorker` takes it: `claude`, `codex`, ... */
	agent: string;
	cwd: string;
}>;

type Failure = Readonly<{ message: string; hint?: string }>;

export type AcpActionDeps = Readonly<{
	repoRoot: (cwd: string) => Promise<Result<string, Failure>>;
	loadPolicy: (root: string) => Promise<Result<Policy, readonly PolicyError[]>>;
	resolveWorker: (name: string) => Result<WorkerSpec, WorkerError>;
	newSessionId: () => string;
	createBridge: (
		input: Readonly<{ policy: Policy; context: RunContext; logFile: string }>,
	) => Promise<GateBridge>;
	/** Serves the editor until either side goes away. */
	proxy: (
		input: Readonly<{ agent: AgentSpec; root: string; bridge: GateBridge }>,
	) => Promise<Result<ProxyReceipt, HarnessError>>;
	writeFile: FsPort["writeFile"];
}>;

type AcpError = Readonly<{
	kind: "worker" | "policy" | "agent" | "io";
	message: string;
	hint?: string;
}>;

type AcpActionResult =
	| Readonly<{ ok: true; receipt: ProxyReceipt; receiptPath: string }>
	| Readonly<{ ok: false; error: AcpError }>;

// ── Core action ──────────────────────────────────────────────────────────────

/** A person is in the editor to answer an `ask`. */
const CONTEXT: RunContext = "interactive";

export async function acpAction(
	options: AcpActionOptions,
	deps: AcpActionDeps,
): Promise<AcpActionResult> {
	const worker = deps.resolveWorker(options.agent);
	if (!worker.ok) {
		const { message, hint } = worker.error;
		return {
			ok: false,
			error: { kind: "worker", message, ...(hint ? { hint } : {}) },
		};
	}
	if (worker.value.protocol !== "acp") {
		return {
			ok: false,
			error: {
				kind: "worker",
				message: `maina acp proxies agents that speak ACP; ${options.agent} is a headless worker`,
			},
		};
	}

	// An editor may open a folder that is not a repo: it is the root then.
	const repo = await deps.repoRoot(options.cwd);
	const root = repo.ok ? repo.value : options.cwd;
	const policy = await deps.loadPolicy(root);
	if (!policy.ok) {
		return {
			ok: false,
			error: {
				kind: "policy",
				message: policy.error
					.map(
						(e) =>
							`${e.file ?? e.source}${e.path ? ` ${e.path}` : ""}: ${e.message}`,
					)
					.join("\n"),
			},
		};
	}

	const id = deps.newSessionId();
	const runs = join(root, ".maina", "runs");
	const bridge = await deps.createBridge({
		policy: policy.value,
		context: CONTEXT,
		logFile: join(runs, `${id}.permissions.jsonl`),
	});
	const served = await deps.proxy({
		agent: worker.value.launch,
		root,
		bridge,
	});
	if (!served.ok) {
		return {
			ok: false,
			error: { kind: "agent", message: served.error.message },
		};
	}

	const receiptPath = join(runs, `${id}.json`);
	const written = await deps.writeFile(
		receiptPath,
		`${JSON.stringify({ runId: id, mode: "acp", ...served.value }, null, 2)}\n`,
	);
	if (!written.ok) {
		return {
			ok: false,
			error: {
				kind: "io",
				message: `the session ended but its receipt could not be written to ${receiptPath}`,
			},
		};
	}
	return { ok: true, receipt: served.value, receiptPath };
}

// ── Default dependencies ─────────────────────────────────────────────────────

async function gitRoot(cwd: string): Promise<Result<string, Failure>> {
	try {
		const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
			cwd,
			stdout: "pipe",
			stderr: "ignore",
		});
		const [out, code] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		return code === 0
			? { ok: true, value: out.trim() }
			: { ok: false, error: { message: `${cwd} is not in a git repo` } };
	} catch (e) {
		return {
			ok: false,
			error: { message: e instanceof Error ? e.message : String(e) },
		};
	}
}

/** maina's stdout as a byte stream: the editor reads the protocol from it. */
function stdoutStream(): WritableStream<Uint8Array> {
	const stdout = Bun.stdout.writer();
	return new WritableStream<Uint8Array>({
		async write(chunk) {
			stdout.write(chunk);
			await stdout.flush();
		},
	});
}

const defaultDeps = (): AcpActionDeps => ({
	repoRoot: gitRoot,
	loadPolicy: loadRunPolicy,
	resolveWorker: (name) => resolveWorker(name),
	newSessionId: () =>
		`acp-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
	createBridge: createGateBridge,
	proxy: ({ agent, root, bridge }) =>
		startProxy({
			editor: { input: Bun.stdin.stream(), output: stdoutStream() },
			agent,
			root,
			bridge,
		}).done,
	writeFile: nodeFs.writeFile,
});

// ── Commander command ────────────────────────────────────────────────────────

export function acpCommand(): Command {
	return new Command("acp")
		.description(
			"Serve an agent to your editor over ACP, with maina's gate on its permission requests",
		)
		.option(
			"--agent <name>",
			"Worker: claude, codex, cursor, gemini, opencode",
			"claude",
		)
		.action(async (flags: Readonly<{ agent: string }>) => {
			const result = await acpAction(
				{ agent: flags.agent, cwd: process.cwd() },
				defaultDeps(),
			);
			if (!result.ok) {
				process.stderr.write(`maina acp: ${result.error.message}\n`);
				if (result.error.hint) process.stderr.write(`${result.error.hint}\n`);
				process.exitCode = 1;
				return;
			}
			process.stderr.write(`maina acp: receipt ${result.receiptPath}\n`);
		});
}
