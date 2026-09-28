/**
 * The Link uplink with its real ports (#590): `fetch`, the Link directory
 * (`~/.maina/link`, or `MAINA_LINK_DIR`) and node:crypto. The resident
 * runtime runs it on a background loop; until the device is enrolled each
 * tick only reads the device state and sends nothing.
 */

import { homedir } from "node:os";
import { processEnv } from "@mainahq/cli/src/env";
import { fetchHttp } from "@mainahq/cli/src/ports";
import { nodeLinkCrypto } from "./link/keys";
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
