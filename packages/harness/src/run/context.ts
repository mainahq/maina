/**
 * Run contexts (FR-HAR-4) and the sandbox a session runs in (FR-SBX-6).
 * Pure: the environment is injected.
 *
 * A run is `interactive` when the person who started it is at the
 * terminal, `unattended` otherwise (no terminal, CI, a background run).
 * An unattended run has nobody to answer an `ask`, so every `ask` is a
 * `deny`, and it never merges, releases or publishes: the built-in
 * `UNATTENDED_DENIED_ACTION_CLASSES` are denied even when the policy it is
 * handed allows them or leaves them off its deny list.
 *
 * The gate enforces a context through `policyForContext` (the policy as the
 * run sees it) and `verdictForContext` (for an `ask` the rules did not
 * produce: a model that is unsure, an action the gate cannot read).
 */

import {
	type ActionClassPolicy,
	type EnvPort,
	type Policy,
	type RunContext,
	UNATTENDED_DENIED_ACTION_CLASSES,
	type Verdict,
} from "@mainahq/core";

const DENIED: ActionClassPolicy = { irreversible: true, verdict: "deny" };

/** The classes a run in `context` never performs. */
function deniedClasses(
	policy: Policy,
	context: RunContext,
): ReadonlySet<string> {
	const builtIn: readonly string[] =
		context === "unattended" ? UNATTENDED_DENIED_ACTION_CLASSES : [];
	// A policy snapshot read back from JSON may predate run contexts.
	return new Set([...builtIn, ...(policy.run?.[context]?.deny ?? [])]);
}

/**
 * `policy` as a run in `context` sees it. Each class the context denies is
 * set to an irreversible `deny`, which beats every allow rule and cannot be
 * restored by a loosening (its entry in `loosened` is dropped). Unattended,
 * every class at `ask` is a `deny` too. Interactive with no deny list, the
 * policy is returned as it is.
 */
export function policyForContext(policy: Policy, context: RunContext): Policy {
	const denied = deniedClasses(policy, context);
	if (context === "interactive" && denied.size === 0) return policy;
	const classes: Record<string, ActionClassPolicy> = {};
	for (const [id, spec] of Object.entries(policy.action_classes)) {
		classes[id] =
			context === "unattended" && spec.verdict === "ask"
				? { ...spec, verdict: "deny" }
				: spec;
	}
	for (const id of denied) classes[id] = DENIED;
	return {
		...policy,
		action_classes: classes,
		loosened: policy.loosened.filter((l) => !denied.has(l.actionClass)),
	};
}

/** Unattended, nobody can answer an `ask`: it is a `deny`. */
export function verdictForContext(
	context: RunContext,
	verdict: Verdict,
): Verdict {
	return context === "unattended" && verdict === "ask" ? "deny" : verdict;
}

type RunContextInput = Readonly<{
	/** `--interactive` / `--unattended`. */
	requested?: RunContext;
	/** stdin and stdout are a terminal. */
	interactiveTerminal: boolean;
	/** Running under CI (`CI` is set). */
	ci: boolean;
}>;

/** The context a run is in: the one asked for, else interactive only at a terminal outside CI. */
export function resolveRunContext(input: RunContextInput): RunContext {
	if (input.requested !== undefined) return input.requested;
	return input.interactiveTerminal && !input.ci ? "interactive" : "unattended";
}

// ── The session's sandbox (FR-SBX-6) ───────────────────────────────────────

/** What `maina run` sets in the environment of the worker it sandboxes. */
export const RUN_ENV = {
	runId: "MAINA_RUN_ID",
	sandbox: "MAINA_SANDBOX",
} as const;

/** The variables that mark a process as a worker of run `runId`. */
export function runEnv(runId: string): Readonly<Record<string, string>> {
	return { [RUN_ENV.runId]: runId, [RUN_ENV.sandbox]: "1" };
}

/**
 * Agents recognised by what they set in their tools' environment, as the
 * worker name `maina run --agent` takes.
 */
const HOST_MARKERS: ReadonlyArray<
	readonly [agent: string, variable: string, value: string | undefined]
> = [
	["claude", "CLAUDECODE", "1"],
	["claude", "CLAUDE_CODE_ENTRYPOINT", undefined],
	["gemini", "GEMINI_CLI", "1"],
	["cursor", "CURSOR_AGENT", "1"],
	["opencode", "OPENCODE", "1"],
];

/** The command that runs a task in maina's sandbox with `agent`. */
export function runCommand(agent: string): string {
	return `maina run --agent ${agent} "<task>"`;
}

export type SessionSandbox =
	/** A worker `maina run` started: its OS sandbox is on. */
	| Readonly<{ state: "on"; runId: string }>
	/**
	 * maina as a plugin inside an agent (hooks, MCP): the gate sees what
	 * the agent asks about, but nothing sandboxes its tools. `command`
	 * runs the same work under `maina run`, sandboxed.
	 */
	| Readonly<{
			state: "off";
			session: "plugin";
			host: string;
			command: string;
	  }>;

function hostAgent(env: EnvPort): string | undefined {
	const marker = HOST_MARKERS.find(([, variable, value]) => {
		const set = env.get(variable);
		return value === undefined ? Boolean(set) : set === value;
	});
	return marker?.[0];
}

/**
 * The sandbox this session runs in. `undefined` outside any agent (a plain
 * terminal), where there is no agent to sandbox.
 */
export function sessionSandbox(env: EnvPort): SessionSandbox | undefined {
	const runId = env.get(RUN_ENV.runId);
	if (runId && env.get(RUN_ENV.sandbox) === "1") return { state: "on", runId };
	const host = hostAgent(env);
	if (host === undefined) return undefined;
	return { state: "off", session: "plugin", host, command: runCommand(host) };
}
