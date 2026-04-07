#!/usr/bin/env bun
export {};

// MCP server mode: `maina --mcp` starts the MCP server instead of the CLI
if (process.argv.includes("--mcp")) {
	const { startServer } = await import("@mainahq/mcp");
	await startServer();
} else {
	const { createProgram } = await import("./program");
	const program = createProgram();
	program.parse();
}
