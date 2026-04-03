#!/usr/bin/env bun

// MCP server mode: `maina --mcp` starts the MCP server instead of the CLI
if (process.argv.includes("--mcp")) {
	// Dynamic import avoids TypeScript rootDir issue with cross-package import
	const mcpPath = new URL("../../mcp/src/index.ts", import.meta.url).pathname;
	const { startServer } = await import(mcpPath);
	await startServer();
} else {
	const { createProgram } = await import("./program");
	const program = createProgram();
	program.parse();
}
