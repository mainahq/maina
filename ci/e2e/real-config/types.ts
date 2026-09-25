/**
 * Shared types for the real-config e2e matrix.
 */

export type Result<T, E> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

export type HostId = "claude-code" | "cursor" | "codex";

export type InstallPath = "plugin" | "cli-setup" | "cli-mcp-add" | "install-sh";

export interface PathCtx {
	readonly home: string;
	readonly cwd: string;
}

/** One file a host reads MCP servers from, and where `maina` sits in it. */
export interface ConfigSource {
	readonly path: string;
	readonly format: "json" | "toml";
	/** Pull the raw `maina` server entry out of the parsed file. */
	readonly select: (parsed: unknown) => unknown;
}

/** The exact process a host would spawn for the maina MCP server. */
export interface LaunchSpec {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	/** Config file the entry was read from. */
	readonly source: string;
}

export interface HostSpec {
	readonly id: HostId;
	/** Tool id `install.sh` uses for this host. */
	readonly installShTool: string;
	/** Client id for `maina mcp add --client`. */
	readonly mcpAddClient: string;
	/** Files the host actually reads, highest precedence first. */
	readonly configSources: (ctx: PathCtx) => readonly ConfigSource[];
	/** Files installers are known to write that the host ignores. */
	readonly strayPaths: (ctx: PathCtx) => readonly string[];
}

/** Why a case did not reach a successful `verify` call. */
export type CaseError =
	| { readonly kind: "installer-missing"; readonly message: string }
	| {
			readonly kind: "installer-failed";
			readonly message: string;
			readonly exitCode: number | null;
	  }
	| {
			readonly kind: "config-not-found";
			readonly message: string;
			readonly searched: readonly string[];
			readonly strays: readonly string[];
	  }
	| {
			readonly kind: "config-invalid";
			readonly message: string;
			readonly path: string;
	  }
	| {
			readonly kind: "command-not-found";
			readonly message: string;
			readonly command: string;
	  }
	| {
			readonly kind: "exited";
			readonly message: string;
			readonly exitCode: number | null;
			readonly stderr: string;
	  }
	| {
			readonly kind: "handshake-timeout";
			readonly message: string;
			readonly timeoutMs: number;
	  }
	| {
			readonly kind: "cold-start-over-budget";
			readonly message: string;
			readonly handshakeMs: number;
			readonly budgetMs: number;
	  }
	| { readonly kind: "tool-call-failed"; readonly message: string };

export interface CaseResult {
	/** MCP `initialize` completed. */
	readonly started: boolean;
	/** Time from spawn to `initialize` response; null if never reached. */
	readonly handshakeMs: number | null;
	/** One `verify` tool call returned a non-error result. */
	readonly toolCallOk: boolean;
	readonly error?: CaseError;
	/** What was spawned, for logs. */
	readonly launch?: LaunchSpec;
}
