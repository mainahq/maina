/**
 * Generate stats.json from source code.
 * Run at build time: `bun packages/docs/scripts/generate-stats.ts`
 *
 * Counts verify tools, CLI commands, MCP tools, and supported languages
 * from the actual source rather than hand-typing numbers.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");

// Count external verify tools from ToolName union type
function countVerifyTools(): number {
	const detect = readFileSync(
		join(ROOT, "packages/core/src/verify/detect.ts"),
		"utf-8",
	);
	const toolNameMatch = detect.match(/export type ToolName\s*=\s*([\s\S]*?);/);
	if (!toolNameMatch) return 0;
	return (toolNameMatch[1].match(/\| "/g) || []).length;
}

// Count built-in checks from runBuiltinChecks aggregator
function countBuiltinChecks(): number {
	const builtin = readFileSync(
		join(ROOT, "packages/core/src/verify/builtin.ts"),
		"utf-8",
	);
	return (builtin.match(/\.\.\.check\w+\(/g) || []).length;
}

// Count CLI commands from commander registrations
function countCliCommands(): number {
	const commandsDir = join(ROOT, "packages/cli/src/commands");
	const files = readdirSync(commandsDir).filter(
		(f) => f.endsWith(".ts") && !f.includes("test"),
	);
	let count = 0;
	for (const file of files) {
		const content = readFileSync(join(commandsDir, file), "utf-8");
		count += (content.match(/\.command\(/g) || []).length;
	}
	return count;
}

// Count MCP tools from server.tool() registrations
function countMcpTools(): number {
	const toolsDir = join(ROOT, "packages/mcp/src/tools");
	const files = readdirSync(toolsDir).filter(
		(f) => f.endsWith(".ts") && !f.includes("test"),
	);
	let count = 0;
	for (const file of files) {
		const content = readFileSync(join(toolsDir, file), "utf-8");
		count += (content.match(/server\.tool\(/g) || []).length;
	}
	return count;
}

// Count supported languages from init detection
function countLanguages(): number {
	const init = readFileSync(
		join(ROOT, "packages/core/src/init/index.ts"),
		"utf-8",
	);
	return (init.match(/languages\.push\(/g) || []).length;
}

const stats = {
	verifyTools: countVerifyTools(),
	builtinChecks: countBuiltinChecks(),
	totalTools: countVerifyTools() + countBuiltinChecks(),
	cliCommands: countCliCommands(),
	mcpTools: countMcpTools(),
	languages: countLanguages(),
	generatedAt: new Date().toISOString(),
};

const outPath = join(ROOT, "packages/docs/src/data/stats.json");
writeFileSync(outPath, JSON.stringify(stats, null, 2));

console.log("Generated stats.json:", stats);
