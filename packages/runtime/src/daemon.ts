/**
 * Runtime daemon entry, started by `daemonSpawner` (ADR 0044).
 *
 *   bun daemon.ts --address <socket> --pid-file <file> --spawn-lock <file>
 *                 --version <v> --idle-ttl-ms <n>
 *
 * Exits 0 when the runtime stops (idle, restart for another version, or
 * SIGTERM/SIGINT) or when another runtime already holds the endpoint; exits 1
 * when it cannot start and 2 on bad arguments.
 */

import { parseArgs } from "node:util";
import { pendingGate } from "./gate";
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

const args = readArgs(process.argv.slice(2));
if (args === null) {
	process.stderr.write("maina runtime: invalid arguments\n");
	process.exit(2);
}

const started = startRuntime(
	{ gate: pendingGate },
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
if (!started.ok) {
	process.exit(started.error.kind === "already_running" ? 0 : 1);
}

const runtime = started.value;
process.on("SIGTERM", () => runtime.stop());
process.on("SIGINT", () => runtime.stop());
await runtime.closed;
process.exit(0);
