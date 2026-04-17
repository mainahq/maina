/**
 * SCIP TypeScript Ingest — run scip-typescript and parse output.
 *
 * Spawns scip-typescript as subprocess, parses JSON output into
 * internal symbol types. Graceful fallback when not installed.
 * Uses Result<T, E> pattern.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../db/index";

// ── Types ──────────────────────────────────────────────────────────────

export interface ScipSymbol {
	name: string;
	kind:
		| "function"
		| "class"
		| "interface"
		| "type"
		| "variable"
		| "method"
		| "property";
	file: string;
	line: number;
	refs: ScipRef[];
}

export interface ScipRef {
	file: string;
	line: number;
	kind: "definition" | "reference" | "implementation";
}

// ── Availability ───────────────────────────────────────────────────────

/**
 * Check if scip-typescript is available on PATH.
 */
export async function isScipAvailable(): Promise<boolean> {
	try {
		const proc = Bun.spawn(["which", "scip-typescript"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

// ── tsconfig Discovery ─────────────────────────────────────────────────

/**
 * Find all tsconfig.json files in a monorepo.
 * Skips node_modules, dist, .git.
 */
export function findTsConfigs(repoRoot: string, maxDepth = 3): string[] {
	const configs: string[] = [];
	const skipDirs = new Set([
		"node_modules",
		"dist",
		".git",
		".maina",
		"coverage",
	]);

	function walk(dir: string, depth: number): void {
		if (depth > maxDepth) return;
		try {
			const entries = readdirSync(dir);
			for (const entry of entries) {
				const full = join(dir, entry);
				if (entry === "tsconfig.json") {
					configs.push(full);
				}
				try {
					if (statSync(full).isDirectory() && !skipDirs.has(entry)) {
						walk(full, depth + 1);
					}
				} catch {
					// Skip unreadable
				}
			}
		} catch {
			// Skip unreadable dirs
		}
	}

	walk(repoRoot, 0);
	return configs.sort();
}

// ── SCIP Output Parsing ────────────────────────────────────────────────

/**
 * Parse scip-typescript JSON output into ScipSymbol array.
 * Expects the format from `scip-typescript index --output json`.
 */
export function parseScipOutput(jsonText: string): Result<ScipSymbol[]> {
	try {
		const data = JSON.parse(jsonText);

		if (!data || !Array.isArray(data.documents)) {
			return { ok: true, value: [] };
		}

		const symbols: ScipSymbol[] = [];

		for (const doc of data.documents) {
			const file = doc.relativePath ?? doc.uri ?? "";
			if (!file) continue;

			for (const occ of doc.occurrences ?? []) {
				if (!occ.symbol || !occ.range) continue;

				// Extract symbol name from SCIP symbol string
				const name = extractSymbolName(occ.symbol);
				if (!name) continue;

				const kind = inferKind(occ.symbolRoles ?? 0);
				const line = (occ.range[0] ?? 0) + 1; // SCIP uses 0-indexed lines

				const refs: ScipRef[] = [];
				if (occ.symbolRoles === 1) {
					refs.push({ file, line, kind: "definition" });
				} else {
					refs.push({ file, line, kind: "reference" });
				}

				symbols.push({ name, kind, file, line, refs });
			}
		}

		return { ok: true, value: symbols };
	} catch (e) {
		return {
			ok: false,
			error: `Failed to parse SCIP output: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

function extractSymbolName(symbol: string): string | null {
	// SCIP symbol format: scheme package descriptor
	// e.g., "npm @mainahq/core 1.0.0 src/verify/pipeline.ts/runPipeline()."
	const parts = symbol.split("/");
	const last = parts[parts.length - 1]?.replace(/[().#]/g, "");
	return last && last.length > 1 ? last : null;
}

function inferKind(symbolRoles: number): ScipSymbol["kind"] {
	// SCIP symbol roles are bitflags, but for simplicity:
	// We default to "function" and rely on the symbol string for more info
	return "function";
}

// ── Runner ─────────────────────────────────────────────────────────────

/**
 * Run scip-typescript on a repo and return parsed symbols.
 * Returns error if scip-typescript is not installed.
 */
export async function runScipTypescript(
	repoRoot: string,
): Promise<Result<ScipSymbol[]>> {
	const available = await isScipAvailable();
	if (!available) {
		return {
			ok: false,
			error:
				"scip-typescript is not installed. Run: npm install -g @sourcegraph/scip-typescript",
		};
	}

	const tsconfigs = findTsConfigs(repoRoot);
	if (tsconfigs.length === 0) {
		return {
			ok: false,
			error: "No tsconfig.json found in repository",
		};
	}

	try {
		const proc = Bun.spawn(["scip-typescript", "index", "--output", "json"], {
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		});

		const output = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			const stderr = await new Response(proc.stderr).text();
			return {
				ok: false,
				error: `scip-typescript exited with code ${exitCode}: ${stderr.slice(0, 200)}`,
			};
		}

		return parseScipOutput(output);
	} catch (e) {
		return {
			ok: false,
			error: `Failed to run scip-typescript: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}
