#!/bin/sh
//bin/sh -c :; command -v bun >/dev/null 2>&1 && exec bun "$0" "$@"; exec node "$0" "$@"

// The two lines above are both shell and JavaScript (#294). As a shell
// script (`//bin/sh` is `/bin/sh`, a no-op) they run this file with Bun when
// it is on PATH, else Node >= 20; to JavaScript line 2 is a comment. MCP host
// entries skip them: they spawn the runtime by absolute path (hosts/launcher.ts).
// The bundler drops comments, so bunup.config.ts re-adds line 2 as a banner.

import { sendCliErrorReport, VERSION } from "@mainahq/core";
import { processEnv } from "./env";

// ── Top-level error handling ────────────────────────────────────────────────

// `DEBUG=1` and `NODE_DEBUG=1` are honoured as aliases — users naturally
// reach for the generic env vars before discovering our prefixed one.
const DEBUG =
	process.argv.includes("--debug") ||
	process.env.MAINA_DEBUG === "1" ||
	process.env.DEBUG === "1" ||
	process.env.NODE_DEBUG === "1";

function printAndReport(err: unknown, origin: string): void {
	const e = err instanceof Error ? err : new Error(String(err ?? "unknown"));
	const code = (e as Error & { code?: unknown }).code;
	const prefix =
		origin === "unhandledRejection" ? "Unhandled rejection" : "Error";
	const codeStr =
		typeof code === "string" || typeof code === "number" ? ` [${code}]` : "";
	process.stderr.write(`${prefix}${codeStr}: ${e.message}\n`);
	if (DEBUG && e.stack) {
		process.stderr.write(`${e.stack}\n`);
	} else {
		process.stderr.write(
			"(run with --debug, MAINA_DEBUG=1, or DEBUG=1 for full stack)\n",
		);
	}

	// Preserve the original failure code when one is available: a numeric
	// `err.code`, or whatever the app has already set on `process.exitCode`.
	// Fall back to 1.
	const existing = process.exitCode;
	const exitCode =
		typeof code === "number"
			? code
			: typeof existing === "number" && existing !== 0
				? existing
				: 1;
	process.exitCode = exitCode;

	// Fire-and-forget; never block the crash path on the network call.
	// `sendCliErrorReport` already swallows its own errors and times out at 1s.
	void sendCliErrorReport(e, {
		env: processEnv,
		mainaVersion: VERSION,
		argv: process.argv,
	}).finally(() => {
		process.exit(exitCode);
	});

	// Safety net: if telemetry somehow hangs past its own timeout, force exit
	// with the preserved code. `.unref()` lets Node terminate early if the
	// telemetry promise resolved first.
	setTimeout(() => process.exit(exitCode), 1500).unref?.();
}

process.on("uncaughtException", (err) =>
	printAndReport(err, "uncaughtException"),
);
process.on("unhandledRejection", (reason) =>
	printAndReport(reason, "unhandledRejection"),
);

// MCP server mode: `maina --mcp` starts the MCP server instead of the CLI
if (process.argv.includes("--mcp")) {
	const { startServer } = await import("@mainahq/mcp");
	await startServer();
} else {
	const { createProgram } = await import("./program");
	const program = createProgram();
	program.parse();
}
