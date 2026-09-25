/**
 * Standalone runtime entry (v1 task 2.3, FR-INS-1; ADR 0045).
 *
 * `build/standalone.ts` compiles this file into the self-contained `maina`
 * executable that `launcher/launch.sh` and `launcher/launch.ps1` run:
 *
 *   maina mcp                 the MCP server over stdio
 *   maina hook <event>        one host hook (native event name, JSON on stdin)
 *   maina cli [args...]       the maina CLI
 *   maina runtime-daemon ...  the resident runtime (spawned by clients)
 *
 * Each mode loads only what it needs, so a cold MCP start does not pay for
 * the CLI and a hook does not pay for the MCP server.
 */

import { failClosedHookOutput } from "./hook-fallback";

const [mode, ...rest] = process.argv.slice(2);

switch (mode) {
	case "mcp": {
		const { startServer } = await import("@mainahq/mcp");
		await startServer();
		break;
	}
	case "hook": {
		// The gate adapters (mainahq/maina#309–#311) are not wired in yet, so
		// every hook gets the host's fail-closed answer: never an allow.
		process.stdout.write(
			`${failClosedHookOutput(rest[0] ?? "", "gate_not_active")}\n`,
		);
		break;
	}
	case "cli": {
		// The CLI reads its arguments from process.argv after the script path.
		process.argv.splice(2, 1);
		await import("@mainahq/cli/src/index.ts");
		break;
	}
	case "runtime-daemon": {
		const { runDaemon } = await import("../daemon-main");
		process.exit(await runDaemon(rest));
		break;
	}
	default:
		process.stderr.write(
			"usage: maina mcp | hook <event> | cli [args...] | runtime-daemon ...\n",
		);
		process.exit(64);
}
