/**
 * `maina wiki ingest <source>` — ingest a local file into the wiki.
 *
 * Reads a file from the local filesystem, copies it to .maina/wiki/raw/
 * with a sanitized filename, and logs success.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import type { Command } from "commander";
import { EXIT_PASSED, EXIT_TOOL_FAILURE, outputJson } from "../../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WikiIngestResult {
	ingested: boolean;
	source: string;
	destination: string;
	error?: string;
}

export interface WikiIngestOptions {
	json?: boolean;
	cwd?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sanitize a filename for safe wiki storage.
 * Replaces non-alphanumeric characters (except dots, dashes, underscores) with dashes.
 */
function sanitizeFilename(name: string): string {
	return name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-{2,}/g, "-");
}

// ── Core Action (testable) ──────────────────────────────────────────────────

export async function wikiIngestAction(
	source: string,
	options: WikiIngestOptions = {},
): Promise<WikiIngestResult> {
	const cwd = options.cwd ?? process.cwd();

	// Resolve source path
	const sourcePath = source.startsWith("/") ? source : join(cwd, source);

	// Check source file exists
	if (!existsSync(sourcePath)) {
		return {
			ingested: false,
			source: sourcePath,
			destination: "",
			error: `Source file not found: ${sourcePath}`,
		};
	}

	// Read source content
	let content: string;
	try {
		content = readFileSync(sourcePath, "utf-8");
	} catch (e) {
		return {
			ingested: false,
			source: sourcePath,
			destination: "",
			error: `Failed to read source file: ${e instanceof Error ? e.message : String(e)}`,
		};
	}

	// Ensure .maina/wiki/raw/ exists
	const rawDir = join(cwd, ".maina", "wiki", "raw");
	mkdirSync(rawDir, { recursive: true });

	// Write to raw/ with sanitized filename
	const sanitized = sanitizeFilename(basename(sourcePath));
	const destPath = join(rawDir, sanitized);
	writeFileSync(destPath, content);

	return {
		ingested: true,
		source: sourcePath,
		destination: destPath,
	};
}

// ── Commander Command ────────────────────────────────────────────────────────

export function wikiIngestCommand(parent: Command): void {
	parent
		.command("ingest <source>")
		.description("Ingest a local file into the wiki")
		.option("--json", "Output JSON for CI")
		.action(async (source: string, options) => {
			const jsonMode = options.json ?? false;

			if (!jsonMode) {
				intro("maina wiki ingest");
			}

			const result = await wikiIngestAction(source, { json: jsonMode });

			if (!jsonMode) {
				if (result.ingested) {
					log.success(`Ingested: ${result.source}`);
					log.info(`Saved to: ${result.destination}`);
					outro("Done.");
				} else {
					log.error(result.error ?? "Ingest failed.");
					outro("Failed.");
				}
			} else {
				outputJson(result, result.ingested ? EXIT_PASSED : EXIT_TOOL_FAILURE);
			}
		});
}
