/**
 * A real stdio MCP server over the fake runtime, spawned by
 * `resilience.test.ts`: `status` prints to the console on every call and
 * `verify` throws, so the test can watch the process's actual stdout.
 */

import { startMcp } from "../server";
import { fakeRuntime } from "./fixtures";

const { runtime } = fakeRuntime({
	status: async () => {
		// biome-ignore lint/suspicious/noConsole: the capability prints on purpose
		console.log("noise from console.log");
		// biome-ignore lint/suspicious/noConsole: the capability prints on purpose
		console.info("noise from console.info");
		// biome-ignore lint/suspicious/noConsole: the capability prints on purpose
		console.debug("noise from console.debug");
		// biome-ignore lint/suspicious/noConsole: the capability prints on purpose
		console.table([{ noise: "from console.table" }]);
		// Bun's own `console.write` writes straight to fd 1 as well.
		// biome-ignore lint/suspicious/noConsole: the capability prints on purpose
		console.write("noise from console.write\n");
		return {
			ok: true,
			value: { graphIndexed: false, wikiInitialized: false, policyErrors: [] },
		};
	},
	verify: async () => {
		throw new Error("verify blew up");
	},
});

await startMcp(runtime, { tools: ["status", "verify"] });
