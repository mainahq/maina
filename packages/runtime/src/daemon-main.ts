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

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { processEnv } from "@mainahq/cli/src/env";
import type { DecisionRecord } from "@mainahq/core";
import { systemGates } from "./gate-system";
import { createGraphSync, systemGraphSyncPorts } from "./graph-hooks";
import { startLoop } from "./lifecycle";
import { emitDecision } from "./link/producers/decision";
import {
	collectInventory,
	createInventoryReporter,
} from "./link/producers/inventory";
import {
	systemInventoryPorts,
	systemPolicySync,
	systemUplink,
} from "./link-system";
import { createSystem1Port } from "./model/infer";
import { createPluginRuns, withRunEvents } from "./run-events";
import { startRuntime } from "./server";
import { createShadowRunner } from "./shadow";
import { createStopVerify } from "./stop-verify";
import { systemStopVerifyPorts } from "./stop-verify-system";

/** How often the inventory is looked at again; only a change is sent. */
const INVENTORY_INTERVAL_MS = 15 * 60_000;

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
	// Remembers each session's edits and verifies them on its stop (FR-VER-7).
	const stops = createStopVerify(systemStopVerifyPorts());
	// The cached System 1 model loads in the background: until it serves,
	// and for good if it cannot, the rules and heuristics decide (#338).
	// Loaded lazily, so the engines cost the daemon's start nothing.
	const model = createSystem1Port(
		import("./model/system").then((m) => m.loadSystemModel()),
		{
			notify: (notice) => process.stderr.write(`maina runtime: ${notice}\n`),
		},
	);
	const shadow = createShadowRunner({
		model,
		clock: { now: () => performance.now() },
	});
	// Maina Link (#590, #591): events queue in the device's outbox while it is
	// enrolled (nothing otherwise) and go to the cloud in the background.
	const uplink = systemUplink();
	const linkFailed = (what: string) => (error: unknown) =>
		process.stderr.write(
			`maina runtime: link ${what} failed: ${error instanceof Error ? error.message : JSON.stringify(error)}\n`,
		);
	// Each logged gate decision becomes a `decision` event, queued after the
	// host has its answer: the outbox write is never on the gate path.
	const onDecision = (record: DecisionRecord): void => {
		setImmediate(() => {
			const emitted = emitDecision(uplink, record);
			if (!emitted.ok) linkFailed("decision event")(emitted.error);
		});
	};
	// Plugin sessions become runs for the run board (#594): a session's start,
	// its gated tool calls and its stop, queued after the host has its answer.
	const runs = createPluginRuns({
		sink: uplink,
		ci: Boolean(processEnv.get("CI")),
		now: () => Date.now(),
		newRunId: () => `run_${randomBytes(12).toString("hex")}`,
		onError: linkFailed("run event"),
	});
	const ports = withRunEvents(
		{
			// A remote approval's events (#593) queue on the uplink too.
			gate: systemGates({
				model,
				shadow,
				onDecision,
				approvalEvents: uplink,
			}).runtime,
			observe: (event) => {
				stops.observe(event);
				return graph.observe(event);
			},
			stop: stops.stop,
		},
		// `maina run` workers send theirs over `run.event`.
		{ runs, sink: uplink },
	);
	const started = startRuntime(ports, {
		endpoint: {
			address: args.address,
			pidFile: args.pidFile,
			spawnLock: args.spawnLock,
		},
		version: args.version,
		idleTtlMs: args.idleTtlMs,
	});
	if (!started.ok) return started.error.kind === "already_running" ? 0 : 1;

	const runtime = started.value;
	// The outbox goes to the cloud in the background, off the gate path; an
	// unenrolled device only reads its state each tick.
	const loop = startLoop(uplink.tick, { onError: linkFailed("uplink") });
	// The inventory on start, then again whenever it changes (FR-INV-1).
	const inventory = createInventoryReporter(uplink);
	const inventoryLoop = startLoop(
		async () => {
			const facts = await collectInventory(systemInventoryPorts(args.version));
			const reported = inventory.report(facts);
			if (!reported.ok) linkFailed("inventory")(reported.error);
			return INVENTORY_INTERVAL_MS;
		},
		{ onError: linkFailed("inventory") },
	);
	// The org's policy bundle (#592), pulled in the background: the gate
	// reads the held copy from disk, so a slow or down cloud never reaches it.
	const policySync = systemPolicySync();
	let policyFailure: string | null = null;
	const policyLoop = startLoop(
		async () => {
			const wait = await policySync.tick();
			const { lastError } = policySync.status();
			// Said once per kind of failure, not once a minute while offline.
			const kind = lastError === null ? null : lastError.kind;
			if (lastError !== null && kind !== policyFailure) {
				linkFailed("policy pull")(lastError);
			}
			policyFailure = kind;
			return wait;
		},
		{ onError: linkFailed("policy pull") },
	);
	process.on("SIGTERM", () => runtime.stop());
	process.on("SIGINT", () => runtime.stop());
	await runtime.closed;
	loop.stop();
	inventoryLoop.stop();
	policyLoop.stop();
	return 0;
}
