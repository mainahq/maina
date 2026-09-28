/**
 * The Link uplink with its real ports (#590): `fetch`, the Link directory
 * (`~/.maina/link`, or `MAINA_LINK_DIR`) and node:crypto. The resident
 * runtime runs it on a background loop; until the device is enrolled each
 * tick only reads the device state and sends nothing.
 *
 * And the inventory's real ports (#591): the agent CLIs on PATH (harness
 * `agentInventory`, whose `--version` probes never block the event loop)
 * and the agents' user-level config files.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { processEnv } from "@mainahq/cli/src/env";
import { fetchHttp } from "@mainahq/cli/src/ports";
import { systemInventoryProbe } from "@mainahq/harness/src/workers/probe";
import { agentInventory } from "@mainahq/harness/src/workers/registry";
import { nodeLinkCrypto } from "./link/keys";
import type { InventoryPorts } from "./link/producers/inventory";
import { fileLinkStore, linkDir } from "./link/store";
import { createUplink } from "./link/uplink";

export function systemUplink(): ReturnType<typeof createUplink> {
	return createUplink({
		http: fetchHttp,
		store: fileLinkStore(linkDir(processEnv, homedir())),
		crypto: nodeLinkCrypto,
		clock: () => new Date(),
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
