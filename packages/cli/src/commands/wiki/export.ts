/**
 * `maina wiki export <format> [--out <path>]` — #202.
 *
 * Compiles the wiki in-memory (dry-run) and serializes the resulting graph
 * into one of the supported formats (cypher, graphml, obsidian). Writes to
 * a file (single-file formats) or a directory (Obsidian).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
	switch (format) {
		case "cypher":
			return "./maina-export.cypher";
		case "graphml":
			return "./maina-export.graphml";
		case "obsidian":
			return "./maina-obsidian";
	}
}

export async function wikiExportAction(
	format: string,
	options: { out?: string; cwd?: string; json?: boolean } = {},
): Promise<WikiExportOutcome | null> {
	if (!VALID_FORMATS.includes(format as ExportFormat)) {
		if (!options.json) {
			log.error(
				`Unknown format "${format}". Expected one of: ${VALID_FORMATS.join(", ")}`,
			);
		}
		return null;
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
		if (!options.json) {
			log.error(`Compile failed: ${compiled.error ?? "unknown error"}`);
		}
		return null;
	}

	const { graph, articles } = compiled.value;
	const result = exportGraph(graph, articles, fmt);
	if (!result.ok) {
		if (!options.json) log.error(result.error);
		return null;
	}

	let filesWritten = 0;
	let bytes = 0;
	if (result.format === "obsidian") {
		mkdirSync(outPath, { recursive: true });
		for (const [relPath, contents] of Object.entries(result.files)) {
			const full = join(outPath, relPath);
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

	return { format: fmt, outPath, filesWritten, bytes };
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
			const outcome = await wikiExportAction(format, opts);
			if (!outcome) {
				if (opts.json) outputJson({ success: false });
				process.exit(1);
			}
			if (opts.json) outputJson({ success: true, ...outcome });
			process.exit(EXIT_PASSED);
		});
}
