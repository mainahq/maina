/**
 * `maina wiki export <format> [--out <path>]` — #202.
 *
 * Compiles the wiki in-memory (dry-run) and serializes the resulting graph
 * into one of the supported formats (cypher, graphml, obsidian). Writes to
 * a file (single-file formats) or a directory (Obsidian).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { log } from "@clack/prompts";
import { compileWiki, type ExportFormat, exportGraph } from "@mainahq/core";
import type { Command } from "commander";
import { EXIT_PASSED, outputJson } from "../../json";

type WikiExportOutcome = {
	format: ExportFormat;
	outPath: string;
	filesWritten: number;
	bytes: number;
};

const VALID_FORMATS: readonly ExportFormat[] = [
	"cypher",
	"graphml",
	"obsidian",
];

function defaultOutPath(format: ExportFormat): string {
	// Matches the feature spec's `./maina-export-<format>` convention and
	// appends the right extension for single-file formats.
	switch (format) {
		case "cypher":
			return "./maina-export-cypher.cypher";
		case "graphml":
			return "./maina-export-graphml.graphml";
		case "obsidian":
			return "./maina-export-obsidian";
	}
}

type ExportActionResult =
	| { ok: true; outcome: WikiExportOutcome }
	| { ok: false; error: string };

export async function wikiExportAction(
	format: string,
	options: { out?: string; cwd?: string; json?: boolean } = {},
): Promise<ExportActionResult> {
	if (!VALID_FORMATS.includes(format as ExportFormat)) {
		const error = `Unknown format "${format}". Expected one of: ${VALID_FORMATS.join(", ")}`;
		if (!options.json) log.error(error);
		return { ok: false, error };
	}
	const fmt = format as ExportFormat;
	const cwd = options.cwd ?? process.cwd();
	const outPath = resolve(cwd, options.out ?? defaultOutPath(fmt));

	const compiled = await compileWiki({
		repoRoot: cwd,
		mainaDir: join(cwd, ".maina"),
		wikiDir: join(cwd, ".maina", "wiki"),
		full: true,
		dryRun: true,
	});
	if (!compiled.ok) {
		const error = `Compile failed: ${compiled.error ?? "unknown error"}`;
		if (!options.json) log.error(error);
		return { ok: false, error };
	}

	const { graph, articles } = compiled.value;
	const result = exportGraph(graph, articles, fmt);
	if (!result.ok) {
		if (!options.json) log.error(result.error);
		return { ok: false, error: result.error };
	}

	try {
		let filesWritten = 0;
		let bytes = 0;
		if (result.format === "obsidian") {
			mkdirSync(outPath, { recursive: true });
			for (const [relPath, contents] of Object.entries(result.files)) {
				// Guard against path traversal: reject absolute paths and any
				// resolved target that would land outside outPath.
				if (isAbsolute(relPath)) {
					const error = `export rejected absolute path: ${relPath}`;
					if (!options.json) log.error(error);
					return { ok: false, error };
				}
				const full = resolve(outPath, relPath);
				const rel = relative(outPath, full);
				if (rel.startsWith("..") || isAbsolute(rel)) {
					const error = `export rejected path traversal: ${relPath}`;
					if (!options.json) log.error(error);
					return { ok: false, error };
				}
				mkdirSync(dirname(full), { recursive: true });
				writeFileSync(full, contents);
				filesWritten += 1;
				bytes += Buffer.byteLength(contents, "utf8");
			}
		} else {
			mkdirSync(dirname(outPath), { recursive: true });
			writeFileSync(outPath, result.contents);
			filesWritten = 1;
			bytes = Buffer.byteLength(result.contents, "utf8");
		}

		if (!options.json) {
			log.success(
				`Wrote ${filesWritten} file${filesWritten === 1 ? "" : "s"} (${bytes} bytes) to ${outPath}`,
			);
		}
		return {
			ok: true,
			outcome: { format: fmt, outPath, filesWritten, bytes },
		};
	} catch (e) {
		const error = `Write failed: ${e instanceof Error ? e.message : String(e)}`;
		if (!options.json) log.error(error);
		return { ok: false, error };
	}
}

export function wikiExportCommand(parent: Command): void {
	parent
		.command("export <format>")
		.description(
			"Export the knowledge graph as cypher | graphml | obsidian (see #202)",
		)
		.option(
			"--out <path>",
			"Output path (defaults to ./maina-export.<ext> or ./maina-obsidian/)",
		)
		.option("--json", "Output JSON for CI")
		.action(async (format: string, opts: { out?: string; json?: boolean }) => {
			const result = await wikiExportAction(format, opts);
			if (!result.ok) {
				if (opts.json) outputJson({ success: false, error: result.error });
				process.exit(1);
			}
			if (opts.json) outputJson({ success: true, ...result.outcome });
			process.exit(EXIT_PASSED);
		});
}
