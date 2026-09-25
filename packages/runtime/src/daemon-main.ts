/**
 * The resident runtime daemon (ADR 0044), run by `daemon.ts` from source and
 * by the standalone runtime's `runtime-daemon` mode (ADR 0045).
 *
 *   --address <socket> --pid-file <file> --spawn-lock <file>
 *   --version <v> --idle-ttl-ms <n>
 *
 * Resolves to the exit code: 0 when the runtime stops (idle, restart for
 * another version, or SIGTERM/SIGINT) or when another runtime already holds
 * the endpoint; 1 when it cannot start and 2 on bad arguments.
 */

import { parseArgs } from "node:util";
import { systemGates } from "./gate-system";
import { createGraphSync, systemGraphSyncPorts } from "./graph-hooks";
import { startRuntime } from "./server";

type Args = Readonly<{
	address: string;
	pidFile: string;
	spawnLock: string;
	version: string;
	idleTtlMs: number;
}>;

function readArgs(argv: readonly string[]): Args | null {
	try {
		const { values } = parseArgs({
			args: [...argv],
			strict: true,
			options: {
				address: { type: "string" },
				"pid-file": { type: "string" },
				"spawn-lock": { type: "string" },
				version: { type: "string" },
				"idle-ttl-ms": { type: "string" },
			},
		});
		const idleTtlMs = Number(values["idle-ttl-ms"]);
		const { address, version } = values;
		const pidFile = values["pid-file"];
		const spawnLock = values["spawn-lock"];
		if (!address || !pidFile || !spawnLock || !version) return null;
		if (!Number.isInteger(idleTtlMs) || idleTtlMs <= 0) return null;
		return { address, pidFile, spawnLock, version, idleTtlMs };
	} catch {
		return null;
	}
}

export async function runDaemon(argv: readonly string[]): Promise<number> {
	const args = readArgs(argv);
	if (args === null) {
		process.stderr.write("maina runtime: invalid arguments\n");
		return 2;
	}
	const graph = createGraphSync(systemGraphSyncPorts(), {
		onError: (root, error) => {
			// A typed `GraphSyncError`, or whatever a misbehaving port threw.
			const message =
				error instanceof Error ? error.message : JSON.stringify(error);
			process.stderr.write(
				`maina runtime: graph sync failed for ${root}: ${message}\n`,
			);
		},
	});
	const started = startRuntime(
		{ gate: systemGates().runtime, observe: graph.observe },
		{
			endpoint: {
				address: args.address,
				pidFile: args.pidFile,
				spawnLock: args.spawnLock,
			},
			version: args.version,
			idleTtlMs: args.idleTtlMs,
		},
	);
	if (!started.ok) return started.error.kind === "already_running" ? 0 : 1;

	const runtime = started.value;
	process.on("SIGTERM", () => runtime.stop());
	process.on("SIGINT", () => runtime.stop());
	await runtime.closed;
	return 0;
}
