/**
 * Test fixture: a runtime process whose gate kills the process mid-request,
 * so `crash.test.ts` can observe a runtime dying with a request in flight.
 *
 * Usage: bun crashing-runtime.ts <address> <pidFile> <spawnLock> <version>
 */

import { startRuntime } from "../../server";

const [address = "", pidFile = "", spawnLock = "", version = ""] =
	process.argv.slice(2);

const started = startRuntime(
	{ gate: () => process.exit(1) },
	{
		endpoint: { address, pidFile, spawnLock },
		version,
		idleTtlMs: 10_000,
	},
);
if (!started.ok) process.exit(2);
await started.value.closed;
process.exit(0);
