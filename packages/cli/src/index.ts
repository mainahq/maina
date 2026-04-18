#!/usr/bin/env bun

import { sendCliErrorReport } from "@mainahq/core";
import pkg from "../package.json" with { type: "json" };

// ── Top-level error handling ────────────────────────────────────────────────

const DEBUG =
	process.argv.includes("--debug") || process.env.MAINA_DEBUG === "1";

function printAndReport(err: unknown, origin: string): void {
	const e = err instanceof Error ? err : new Error(String(err ?? "unknown"));
	// biome-ignore lint/suspicious/noExplicitAny: err.code is platform-specific
	const code = (e as any).code as string | undefined;
	const prefix =
		origin === "unhandledRejection" ? "Unhandled rejection" : "Error";
	const codeStr = code ? ` [${code}]` : "";
	process.stderr.write(`${prefix}${codeStr}: ${e.message}\n`);
	if (DEBUG && e.stack) {
		process.stderr.write(`${e.stack}\n`);
	} else {
		process.stderr.write(
			"(run with --debug or MAINA_DEBUG=1 for full stack)\n",
		);
	}

	// Fire-and-forget; swallow everything so the crash path isn't blocked.
	void sendCliErrorReport(e, {
		mainaVersion: pkg.version,
		argv: process.argv,
	}).finally(() => {
		process.exit(1);
	});

	// Safety net: if telemetry somehow hangs past its timeout, force exit.
	setTimeout(() => process.exit(1), 1500).unref?.();
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
