/**
 * Tool Auto-Detection for the Verify Engine.
 *
 * Detects which verification tools (biome, semgrep, trivy, etc.) are
 * available on the system by attempting to run their version commands.
 * Checks both global PATH and local node_modules/.bin/ for each tool.
 * Missing tools are gracefully skipped.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export type ToolName =
	| "biome"
	| "semgrep"
	| "trivy"
	| "secretlint"
	| "sonarqube"
	| "stryker"
	| "diff-cover"
	| "ruff"
	| "golangci-lint"
	| "cargo-clippy"
	| "cargo-audit"
	| "playwright";

export interface DetectedTool {
	name: string;
	command: string;
	version: string | null;
	available: boolean;
}

export const TOOL_REGISTRY: Record<
	ToolName,
	{ command: string; versionFlag: string }
> = {
	biome: { command: "biome", versionFlag: "--version" },
	semgrep: { command: "semgrep", versionFlag: "--version" },
	trivy: { command: "trivy", versionFlag: "--version" },
	secretlint: { command: "secretlint", versionFlag: "--version" },
	sonarqube: { command: "sonar-scanner", versionFlag: "--version" },
	stryker: { command: "stryker", versionFlag: "--version" },
	"diff-cover": { command: "diff-cover", versionFlag: "--version" },
	ruff: { command: "ruff", versionFlag: "--version" },
	"golangci-lint": { command: "golangci-lint", versionFlag: "--version" },
	"cargo-clippy": { command: "cargo", versionFlag: "clippy --version" },
	"cargo-audit": { command: "cargo-audit", versionFlag: "--version" },
	playwright: { command: "npx", versionFlag: "playwright --version" },
};

/**
 * Parse a version string from command output.
 * Looks for common version patterns like "1.2.3", "v1.2.3", "Version: 1.2.3".
 */
function parseVersion(output: string): string | null {
	const match = output.match(/v?(\d+\.\d+(?:\.\d+)?(?:[._-]\w+)*)/);
	return match?.[1] ?? null;
}

/**
 * Try to spawn a command and parse its version output.
 * Returns the detected version string on success, or null on failure.
 */
async function tryCommand(
	command: string,
	versionFlag: string,
): Promise<string | null> {
	try {
		const args = versionFlag.includes(" ")
			? [command, ...versionFlag.split(" ")]
			: [command, versionFlag];
		const proc = Bun.spawn(args, {
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		if (exitCode === 0) {
			return parseVersion(stdout) ?? parseVersion(stderr);
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Find the nearest node_modules/.bin directory by walking up from cwd.
 * Returns the path if found, null otherwise.
 */
function findLocalBinDir(startDir: string = process.cwd()): string | null {
	let dir = startDir;
	const root = "/";

	while (dir !== root) {
		const binDir = join(dir, "node_modules", ".bin");
		if (existsSync(binDir)) {
			return binDir;
		}
		const parent = join(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/**
 * Detect whether a single tool is available on the system.
 * Tries the global PATH first, then falls back to node_modules/.bin/.
 * Never throws — unavailable tools return `{ available: false }`.
 */
export async function detectTool(name: ToolName): Promise<DetectedTool> {
	const entry = TOOL_REGISTRY[name];

	// Try global PATH first
	const globalVersion = await tryCommand(entry.command, entry.versionFlag);
	if (globalVersion !== null) {
		return {
			name,
			command: entry.command,
			version: globalVersion,
			available: true,
		};
	}

	// Try local node_modules/.bin/
	const localBin = findLocalBinDir();
	if (localBin) {
		const localCommand = join(localBin, entry.command);
		if (existsSync(localCommand)) {
			const localVersion = await tryCommand(localCommand, entry.versionFlag);
			if (localVersion !== null) {
				return {
					name,
					command: localCommand,
					version: localVersion,
					available: true,
				};
			}
		}
	}

	return {
		name,
		command: entry.command,
		version: null,
		available: false,
	};
}

/**
 * Detect all registered tools in parallel.
 * Returns an array of DetectedTool in registry order.
 */
export async function detectTools(): Promise<DetectedTool[]> {
	const names = Object.keys(TOOL_REGISTRY) as ToolName[];
	const results = await Promise.all(names.map((name) => detectTool(name)));
	return results;
}

/**
 * Quick check: is a specific tool available?
 */
export async function isToolAvailable(name: ToolName): Promise<boolean> {
	const tool = await detectTool(name);
	return tool.available;
}
