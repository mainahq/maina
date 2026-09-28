/**
 * The Link uplink with its real ports (#590): `fetch`, the Link directory
 * (`~/.maina/link`, or `MAINA_LINK_DIR`) and node:crypto. The resident
 * runtime runs it on a background loop; until the device is enrolled each
 * tick only reads the device state and sends nothing.
 *
 * And the inventory's real ports (#591): the agent CLIs on PATH (harness
 * `agentInventory`, whose `--version` probes never block the event loop)
 * and the agents' user-level config files.
 *
 * And a `maina run`'s side of the run board (#594): its control channel,
 * audited in the Link directory, and the client that hands its run events
 * to the resident runtime, the outbox's one writer.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import cliPackage from "@mainahq/cli/package.json" with { type: "json" };
import { processEnv } from "@mainahq/cli/src/env";
import { fetchHttp } from "@mainahq/cli/src/ports";
import { systemInventoryProbe } from "@mainahq/harness/src/workers/probe";
import { agentInventory } from "@mainahq/harness/src/workers/registry";
import { daemonSpawner } from "./lifecycle";
import { type ControlAuditEntry, createRemoteControl } from "./link/control";
import { nodeLinkCrypto } from "./link/keys";
import { createPolicySync } from "./link/policy-sync";
import type { InventoryPorts } from "./link/producers/inventory";
import { fileLinkStore, linkDir } from "./link/store";
import { createUplink } from "./link/uplink";
import { userEndpoint } from "./registry";
import { createRunEventClient } from "./run-events";

/** A runtime a run's events start lives this long with no request. */
const RUNTIME_IDLE_TTL_MS = 30 * 60_000;
/** A `maina run` process holds its control polls this short, so it exits soon after its run. */
const RUN_CONTROL_WAIT_SECONDS = 5;

function systemLinkPorts() {
	return {
		http: fetchHttp,
		store: fileLinkStore(linkDir(processEnv, homedir())),
		crypto: nodeLinkCrypto,
		clock: () => new Date(),
	};
}

export function systemUplink(): ReturnType<typeof createUplink> {
	return createUplink(systemLinkPorts());
}

/** The policy pull (#592): keeps the org's verified bundle for the gate. */
export function systemPolicySync(): ReturnType<typeof createPolicySync> {
	return createPolicySync(systemLinkPorts());
}

/** Whether this machine is enrolled in Maina Cloud and not revoked. */
export function linkEnrolled(): boolean {
	const read = systemLinkPorts().store.readState();
	return read.ok && read.value !== null && read.value.revokedAt === null;
}

/**
 * The local audit of control messages (#594): one JSON line per message
 * acted on or ignored, in `control.jsonl` in the Link directory, owner-only.
 * A failed write is dropped (the audit never changes an outcome).
 */
function systemControlAudit(): (entry: ControlAuditEntry) => void {
	const dir = linkDir(processEnv, homedir());
	return (entry) => {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		appendFileSync(join(dir, "control.jsonl"), `${JSON.stringify(entry)}\n`, {
			mode: 0o600,
		});
	};
}

/** The run board's control messages for the runs this process holds (#594). */
export function systemRemoteControl(): ReturnType<typeof createRemoteControl> {
	return createRemoteControl(
		{ ...systemLinkPorts(), audit: systemControlAudit() },
		{ waitSeconds: RUN_CONTROL_WAIT_SECONDS },
	);
}

/** Hands a `maina run`'s run events to this user's resident runtime (#594). */
export function systemRunEventClient(): ReturnType<
	typeof createRunEventClient
> {
	const version = cliPackage.version;
	const endpoint = userEndpoint(process.env, version);
	return createRunEventClient({
		endpoint,
		version,
		spawn: daemonSpawner({ endpoint, version, idleTtlMs: RUNTIME_IDLE_TTL_MS }),
	});
}

function readText(path: string): string | null {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

export function systemInventoryPorts(runtimeVersion: string): InventoryPorts {
	const codexHome = processEnv.get("CODEX_HOME");
	return {
		agents: () => agentInventory(systemInventoryProbe),
		readText,
		home: homedir(),
		...(codexHome === undefined || codexHome === "" ? {} : { codexHome }),
		runtimeVersion,
	};
}
