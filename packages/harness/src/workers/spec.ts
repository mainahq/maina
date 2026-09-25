/**
 * What the harness knows about a coding agent it can drive (FR-HAR-1,
 * FR-HAR-7): how to launch it, which protocol it speaks, how much of the
 * policy can be enforced on it, and how to turn its own sandbox off so
 * maina's sandbox is the one that holds.
 */

import type { AgentSpec } from "../worker";

/** The agents maina drives over ACP. */
export type WorkerName = "claude" | "codex" | "cursor" | "gemini" | "opencode";

/**
 * Where the policy is enforced.
 *
 * - `gate`: the agent asks (`session/request_permission`) before a gated
 *   call runs, so the gate can deny it; the sandbox is a second layer.
 * - `sandbox-only`: nothing asks before acting (headless print mode), so
 *   only the sandbox the worker runs in stops a denied action.
 */
export type Enforcement = "gate" | "sandbox-only";

/** How the task reaches the agent. */
export type TaskVia =
	/** `session/prompt` over ACP. */
	| "acp"
	/** Written to the agent's stdin, which is then closed. */
	| "stdin"
	/** Appended as the last command-line argument. */
	| "argument";

/**
 * What maina can rely on without asking the agent. An ACP agent's own
 * capabilities (`initialize`) refine this at run time.
 */
export type WorkerCapabilities = Readonly<{
	/** Asks before a gated call runs, so the gate can deny it. */
	permissionRequests: boolean;
	/** Reports each tool call as it happens (`session/update`). */
	toolCallReports: boolean;
}>;

/** Changes to a launch; `args` go before the launch's own arguments. */
export type LaunchPatch = Readonly<{
	args?: readonly string[];
	env?: Readonly<Record<string, string>>;
}>;

/**
 * The agent's own sandbox. Nested inside maina's (Seatbelt in Seatbelt,
 * a container in a namespace) it tends to fail or to hide what the outer
 * sandbox needs to see, so the sandbox layer applies `disable`.
 */
export type InnerSandbox = Readonly<{
	/** `os`: Seatbelt / Landlock / bubblewrap; `container`: Docker or Podman. */
	kind: "none" | "os" | "container";
	/** Whether it is on unless the user's own config turns it on. */
	enabledByDefault: boolean;
	disable: LaunchPatch &
		Readonly<{
			/**
			 * Turning the sandbox off also stops the agent asking for
			 * permission, so the gate can no longer deny a call: only the
			 * outer sandbox enforces.
			 */
			stopsPermissionRequests?: boolean;
		}>;
}>;

export type WorkerSpec = Readonly<{
	/** `claude`, or `headless:claude` for the headless fallback. */
	name: string;
	launch: AgentSpec;
	protocol: "acp" | "headless";
	enforcement: Enforcement;
	taskVia: TaskVia;
	capabilities: WorkerCapabilities;
	innerSandbox: InnerSandbox;
	/** The installed version, when `--version` printed one. */
	version?: string;
}>;

/** How one mode of an agent (ACP or headless) is found and started. */
export type LaunchMode = Readonly<{
	/** Binaries to look for on PATH, first match wins. */
	binaries: readonly string[];
	args: readonly string[];
	/** Shown when none of `binaries` is installed. */
	install: string;
	innerSandbox: InnerSandbox;
}>;

/** One supported agent: its ACP adapter and its headless print mode. */
export type WorkerDefinition = Readonly<{
	name: WorkerName;
	/** The package whose version `MIN_ADAPTER_VERSIONS` pins. */
	adapterPackage: string;
	acp: LaunchMode;
	headless: LaunchMode & Readonly<{ taskVia: "stdin" | "argument" }>;
}>;

export type WorkerErrorCode = "unknown_worker" | "not_installed" | "outdated";

export type WorkerError = Readonly<{
	code: WorkerErrorCode;
	message: string;
	/** What to run to fix it: an install or upgrade command. */
	hint?: string;
}>;
