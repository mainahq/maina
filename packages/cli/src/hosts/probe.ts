/**
 * Launch one MCP server entry the way its host does and complete the MCP
 * `initialize` handshake (FR-INS-6). The imperative shell behind `maina
 * doctor`'s launch checks; `./health.ts` turns the outcome into checks.
 *
 * Hosts spawn the entry's exact `command` + `args` with their own env
 * merged under the entry's `env`, so a bare command is looked up on the
 * host's PATH, not the shell's. The probe does the same.
 */

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { EnvVars } from "./host-env";

/** The process a host spawns for an MCP entry. */
export interface LaunchSpec {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: EnvVars;
}

export type ProbeOutcome =
	| {
			readonly kind: "not-found";
			readonly command: string;
			/** The PATH the lookup used. */
			readonly path: string;
	  }
	| {
			readonly kind: "spawn-failed";
			readonly executable: string;
			readonly message: string;
	  }
	| {
			readonly kind: "exited";
			readonly executable: string;
			readonly exitCode: number | null;
			readonly stderr: string;
	  }
	| {
			readonly kind: "timeout";
			readonly executable: string;
			readonly timeoutMs: number;
	  }
	| {
			readonly kind: "rejected";
			readonly executable: string;
			readonly message: string;
	  }
	| {
			readonly kind: "ready";
			readonly executable: string;
			readonly handshakeMs: number;
			readonly protocolVersion: string;
			readonly serverName: string;
			readonly serverVersion: string;
	  };

/** Launch `spec` in `cwd` with the host env `env`, then `initialize`. */
export type Probe = (
	spec: LaunchSpec,
	env: EnvVars,
	cwd: string,
) => Promise<ProbeOutcome>;

/** Codex's default `startup_timeout_sec`, the strictest host. */
const HANDSHAKE_TIMEOUT_MS = 10_000;
const STDERR_TAIL = 2_000;

/**
 * Resolve `command` like a host's spawn: anything with a `/` is a path
 * (relative to the spawn cwd), a bare name is looked up on `path`.
 */
function resolveCommand(
	command: string,
	path: string,
	cwd: string,
): string | null {
	if (command.includes("/")) {
		const abs = isAbsolute(command) ? command : resolve(cwd, command);
		return existsSync(abs) ? abs : null;
	}
	return Bun.which(command, { PATH: path });
}

interface RpcReply {
	readonly id?: unknown;
	readonly result?: {
		readonly protocolVersion?: unknown;
		readonly serverInfo?: {
			readonly name?: unknown;
			readonly version?: unknown;
		};
	};
	readonly error?: unknown;
}

type Wait =
	| { readonly type: "reply"; readonly msg: RpcReply }
	| { readonly type: "exit"; readonly code: number | null }
	| { readonly type: "timeout" };

/** The first JSON-RPC reply with `id` on `stdout`; non-JSON lines are ignored. */
async function replyWithId(
	stdout: ReadableStream<Uint8Array>,
	id: number,
): Promise<RpcReply | null> {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of stdout) {
		buffer += decoder.decode(chunk, { stream: true });
		for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (line.length === 0) continue;
			try {
				const msg = JSON.parse(line) as RpcReply;
				if (msg.id === id) return msg;
			} catch {
				// Hosts drop non-JSON stdout too.
			}
		}
	}
	return null;
}

type Piped = Bun.Subprocess<"pipe", "pipe", "pipe">;

function spawnPiped(
	cmd: readonly string[],
	cwd: string,
	env: EnvVars,
): { ok: true; value: Piped } | { ok: false; error: string } {
	try {
		return {
			ok: true,
			value: Bun.spawn([...cmd], {
				cwd,
				env: { ...env },
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			}),
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export const probeMcp: Probe = async (spec, env, cwd) => {
	// Hosts merge the entry's env over their own and spawn with that.
	const spawnEnv: EnvVars = { ...env, ...spec.env };
	const path = spawnEnv.PATH ?? "";
	const executable = resolveCommand(spec.command, path, cwd);
	if (executable === null) {
		return { kind: "not-found", command: spec.command, path };
	}

	const spawned = spawnPiped([executable, ...spec.args], cwd, spawnEnv);
	if (!spawned.ok) {
		return { kind: "spawn-failed", executable, message: spawned.error };
	}
	const proc = spawned.value;

	const t0 = performance.now();
	const stderr = new Response(proc.stderr).text();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const exited = proc.exited.then((code): Wait => ({ type: "exit", code }));
	// stdout closing without a reply means the process is going away.
	const reply = replyWithId(proc.stdout, 1).then((msg): Wait | Promise<Wait> =>
		msg === null ? exited : { type: "reply", msg },
	);
	const timeout = new Promise<Wait>((done) => {
		timer = setTimeout(() => done({ type: "timeout" }), HANDSHAKE_TIMEOUT_MS);
	});

	try {
		proc.stdin.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "maina-doctor", version: "0.0.0" },
				},
			})}\n`,
		);
		proc.stdin.flush();
	} catch {
		// Child already gone (EPIPE); the `exited` race reports why.
	}

	// A reply wins over an exit that races it: the server did answer.
	const first = await Promise.race([reply, exited, timeout]);
	const wait =
		first.type === "exit"
			? await Promise.race([
					reply,
					new Promise<Wait>((done) => setTimeout(() => done(first), 50)),
				])
			: first;
	clearTimeout(timer);
	const handshakeMs = Math.round(performance.now() - t0);
	proc.kill();
	await proc.exited;

	switch (wait.type) {
		case "exit":
			return {
				kind: "exited",
				executable,
				exitCode: wait.code,
				// A grandchild can hold stderr open after the child exits.
				stderr: (
					await Promise.race([
						stderr,
						new Promise<string>((done) => setTimeout(() => done(""), 1_000)),
					])
				)
					.slice(-STDERR_TAIL)
					.trim(),
			};
		case "timeout":
			return { kind: "timeout", executable, timeoutMs: HANDSHAKE_TIMEOUT_MS };
		case "reply": {
			const { msg } = wait;
			if (msg.error !== undefined || msg.result === undefined) {
				return {
					kind: "rejected",
					executable,
					message: JSON.stringify(msg.error ?? msg).slice(0, 500),
				};
			}
			return {
				kind: "ready",
				executable,
				handshakeMs,
				protocolVersion: text(msg.result.protocolVersion),
				serverName: text(msg.result.serverInfo?.name),
				serverVersion: text(msg.result.serverInfo?.version),
			};
		}
		default: {
			const never: never = wait;
			return never;
		}
	}
};
