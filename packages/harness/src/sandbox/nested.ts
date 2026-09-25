/**
 * The agent's own sandbox under maina's (FR-SBX-4, FR-HAR-8). Pure: no I/O.
 *
 * Every worker runs inside maina's OS sandbox. Most agents also sandbox
 * their own tool calls (Codex, Cursor: Seatbelt / Landlock; Claude Code:
 * sandbox-runtime, opt-in; Gemini: a container). Whether that inner
 * sandbox can start inside the outer one was settled by a spike, recorded
 * in ADR 0048 and rerun by `__tests__/nested.test.ts`:
 *
 * - macOS: no. Seatbelt refuses a second profile inside a sandboxed
 *   process (`sandbox_apply: Operation not permitted`), so an agent whose
 *   sandbox is on cannot run a single command.
 * - Linux: see `INNER_SANDBOX_NESTS`.
 * - A container sandbox never nests: no container runtime is reachable
 *   from inside the outer sandbox.
 *
 * Where the inner sandbox cannot nest, `configureInnerSandbox` applies the
 * agent's own switch to turn it off (the worker registry's `disable`
 * patch). The outer sandbox is never touched: it is applied afterwards,
 * around whatever launch this returns, and stays the layer that enforces.
 * If turning the inner sandbox off also stops the agent asking for
 * permission (Codex over ACP), the worker is marked `sandbox-only`.
 */

import type { WorkerName, WorkerSpec } from "../workers/spec";

/**
 * The workers whose own OS sandbox was shown to start inside maina's, per
 * platform (ADR 0048). A platform not listed nests nothing.
 */
export const INNER_SANDBOX_NESTS: Readonly<
	Record<"darwin" | "linux", readonly WorkerName[]>
> = {
	darwin: [],
	linux: [],
};

/**
 * What happened to the agent's own sandbox:
 * `none` it has none; `nested` it stays on, inside maina's;
 * `disabled` it is off (switched off, or, for an opt-in one, left off).
 */
export type InnerOutcome = "none" | "nested" | "disabled";

export type ConfiguredWorker = Readonly<{
	worker: WorkerSpec;
	inner: InnerOutcome;
}>;

export type InnerSandboxOptions = Readonly<{
	/** `process.platform` by default. */
	platform?: string;
	/** Overrides `INNER_SANDBOX_NESTS` for the platform. */
	nests?: readonly string[];
}>;

/** `headless:codex` → `codex`. */
const agentOf = (worker: WorkerSpec): string =>
	worker.name.slice(worker.name.indexOf(":") + 1);

function nestsOn(platform: string): readonly string[] {
	return platform === "darwin" || platform === "linux"
		? INNER_SANDBOX_NESTS[platform]
		: [];
}

export function configureInnerSandbox(
	worker: WorkerSpec,
	options: InnerSandboxOptions = {},
): ConfiguredWorker {
	const inner = worker.innerSandbox;
	if (inner.kind === "none") return { worker, inner: "none" };
	const nests = options.nests ?? nestsOn(options.platform ?? process.platform);
	if (inner.kind === "os" && nests.includes(agentOf(worker))) {
		return { worker, inner: "nested" };
	}
	const { args, env, stopsPermissionRequests } = inner.disable;
	const { launch } = worker;
	const patched: WorkerSpec = {
		...worker,
		launch: {
			...launch,
			args: [...(args ?? []), ...(launch.args ?? [])],
			...(env === undefined && launch.env === undefined
				? {}
				: { env: { ...launch.env, ...env } }),
		},
		...(stopsPermissionRequests === true
			? {
					enforcement: "sandbox-only",
					capabilities: { ...worker.capabilities, permissionRequests: false },
				}
			: {}),
	};
	return { worker: patched, inner: "disabled" };
}
