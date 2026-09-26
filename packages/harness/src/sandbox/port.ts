/**
 * The sandbox port (FR-SBX-1): every worker runs inside an OS sandbox that
 * holds even when the gate is not asked (a headless worker, an agent whose
 * own sandbox had to be turned off). The harness depends on this port only;
 * `runtime-adapter.ts` implements it over Anthropic's sandbox-runtime
 * (`srt`), a research preview, so swapping it out touches one file
 * (ADR 0048).
 *
 * `wrap` turns the command that starts a worker into the command that
 * starts it sandboxed. It never runs anything itself.
 */

import type { Result } from "@mainahq/core";
import type { AgentSpec } from "../worker";

/** A process to start: what `spawnAgent` takes. */
export type Command = AgentSpec;

/**
 * A secret the worker needs, such as its model API key (FR-SBX-3). The
 * worker only ever sees a stand-in value; the real one is swapped in on the
 * way out, and only to `hosts`.
 */
export type Credential = Readonly<{
	/** The environment variable the worker reads it from: `ANTHROPIC_API_KEY`. */
	name: string;
	value: string;
	/** The only hosts the real value is sent to; the worker may reach them. */
	hosts: readonly string[];
}>;

/**
 * What the worker may touch. Writes are denied everywhere except
 * `writeAllow`; reads are allowed everywhere except `readDeny` (with
 * `readAllow` carving exceptions back out of it); the network is denied
 * except `netAllow` and the credentials' hosts.
 */
export type SandboxOptions = Readonly<{
	writeAllow: readonly string[];
	/** Paths inside `writeAllow` that still may not be written. */
	writeDeny?: readonly string[];
	readDeny: readonly string[];
	/** Paths inside `readDeny` that may be read after all. */
	readAllow?: readonly string[];
	/** Host names, `*.example.com` wildcards, optional `:port`. */
	netAllow: readonly string[];
	/** Checked before `netAllow`. */
	netDeny?: readonly string[];
	credentials: readonly Credential[];
	/**
	 * The worker's own temp directory: its `TMPDIR`, readable and writable.
	 * Without one the worker shares the sandbox's default temp directory
	 * with every other worker.
	 */
	tmpDir?: string;
}>;

/**
 * One call the sandbox made about a network connection, as it logged it
 * (FR-SBX-2). `reason` says which rule decided.
 */
export type SandboxDecision = Readonly<{
	kind: "network";
	host: string;
	port: number;
	verdict: "allow" | "deny";
	reason: "allowlist" | "denylist" | "not_allowlisted" | "malformed_host";
}>;

export type SandboxErrorCode =
	| "not_installed"
	| "unsupported_version"
	| "unsupported_platform"
	| "invalid_options"
	| "io";

export type SandboxError = Readonly<{
	code: SandboxErrorCode;
	message: string;
	/** What to run to fix it: an install command. */
	hint?: string;
}>;

export type SandboxPort = Readonly<{
	/** The command that starts `command` inside the sandbox `options` describe. */
	wrap: (
		command: Command,
		options: SandboxOptions,
	) => Result<Command, SandboxError>;
	/** The decisions a wrapped process's stderr records, in order. */
	decisions: (stderr: string) => readonly SandboxDecision[];
}>;
