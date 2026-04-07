import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import {
	generateDependencyDiagram,
	generateModuleSummary,
	type ModuleSummary,
	tryAIGenerate,
} from "@mainahq/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExplainActionOptions {
	scope?: string;
	output?: string;
	save?: boolean;
	cwd?: string;
}

export interface ExplainActionResult {
	displayed: boolean;
	reason?: string;
	diagram?: string;
	summaries?: ModuleSummary[];
	aiSummary?: string;
	outputPath?: string;
	empty?: boolean;
	wikiContext?: string;
	savedToWiki?: string;
}

export interface ExplainDeps {
	generateDependencyDiagram: typeof generateDependencyDiagram;
	generateModuleSummary: typeof generateModuleSummary;
}

// ── Default Dependencies ─────────────────────────────────────────────────────

const defaultDeps: ExplainDeps = {
	generateDependencyDiagram,
	generateModuleSummary,
};

// ── Formatting Helpers ───────────────────────────────────────────────────────

function formatSummaryTable(summaries: ModuleSummary[]): string {
	const header = `  ${"Module".padEnd(30)} ${"Entities".padStart(8)}  ${"Fn".padStart(4)}  ${"Cls".padStart(4)}  ${"Ifc".padStart(4)}  ${"Typ".padStart(4)}`;
	const separator = `  ${"─".repeat(30)} ${"─".repeat(8)}  ${"─".repeat(4)}  ${"─".repeat(4)}  ${"─".repeat(4)}  ${"─".repeat(4)}`;
	const rows = summaries.map(
		(s) =>
			`  ${s.module.padEnd(30)} ${String(s.entityCount).padStart(8)}  ${String(s.functions).padStart(4)}  ${String(s.classes).padStart(4)}  ${String(s.interfaces).padStart(4)}  ${String(s.types).padStart(4)}`,
	);
	return [header, separator, ...rows].join("\n");
}

// ── Wiki Helpers ────────────────────────────────────────────────────────────

/**
 * Search wiki directories for an article matching the given scope/target.
 * Returns the content of the first matching article, or undefined.
 */
function findWikiArticle(mainaDir: string, scope?: string): string | undefined {
	if (!scope) return undefined;
	const wikiDir = join(mainaDir, "wiki");
	if (!existsSync(wikiDir)) return undefined;

	// Normalize scope to a filename-friendly slug
	const slug = scope.replace(/[/\\]/g, "-").toLowerCase();

	// Search in wiki subdirectories for a matching article
	const searchDirs = ["modules", "entities", "features", "architecture"];
	for (const subdir of searchDirs) {
		const dir = join(wikiDir, subdir);
		if (!existsSync(dir)) continue;
		const candidate = join(dir, `${slug}.md`);
		if (existsSync(candidate)) {
			try {
				return readFileSync(candidate, "utf-8");
			} catch {
				// ignore read errors
			}
		}
	}
	return undefined;
}

/**
 * Save an explanation to wiki/raw/ for later compilation.
 */
function saveToWikiRaw(
	mainaDir: string,
	scope: string,
	content: string,
): string {
	const rawDir = join(mainaDir, "wiki", "raw");
	mkdirSync(rawDir, { recursive: true });
	const slug = scope.replace(/[/\\]/g, "-").toLowerCase();
	const filePath = join(rawDir, `${slug}.md`);
	writeFileSync(filePath, content);
	return filePath;
}

// ── Core Action (testable) ───────────────────────────────────────────────────

/**
 * The core explain logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function explainAction(
	options: ExplainActionOptions,
	deps: ExplainDeps = defaultDeps,
): Promise<ExplainActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");

	// ── Generate diagram ───────────────────────────────────────────────
	const diagramResult = deps.generateDependencyDiagram(mainaDir, {
		scope: options.scope,
	});
	if (!diagramResult.ok) {
		return { displayed: false, reason: diagramResult.error };
	}

	// ── Generate module summary ────────────────────────────────────────
	const summaryResult = deps.generateModuleSummary(mainaDir);
	if (!summaryResult.ok) {
		return { displayed: false, reason: summaryResult.error };
	}

	const diagram = diagramResult.value;
	const summaries = summaryResult.value;

	// Detect if codebase is empty (no edges, no entities)
	const isEmpty = diagram === "graph LR\n" && summaries.length === 0;

	// Check for wiki context
	const wikiContext = findWikiArticle(mainaDir, options.scope);

	// Try AI summary when API key available
	let aiSummary: string | undefined;
	if (!isEmpty) {
		const modulesText = summaries
			.map(
				(s) =>
					`${s.module}: ${s.functions}fn, ${s.classes}cls, ${s.interfaces}ifc`,
			)
			.join("\n");
		const wikiPreamble = wikiContext
			? `Existing wiki context:\n${wikiContext}\n\n`
			: "";
		const aiResult = await tryAIGenerate(
			"explain",
			mainaDir,
			{ diagram, modules: modulesText },
			`${wikiPreamble}Summarize this codebase structure:\n\n${diagram}\n\nModules:\n${modulesText}`,
		);
		if (aiResult.text) {
			aiSummary = aiResult.text;
		}
	}

	// Save to wiki/raw/ if --save is set
	let savedToWiki: string | undefined;
	if (options.save && options.scope && (aiSummary ?? diagram)) {
		const content = aiSummary ?? diagram;
		savedToWiki = saveToWikiRaw(mainaDir, options.scope, content);
	}

	return {
		displayed: true,
		diagram,
		summaries,
		aiSummary,
		outputPath: options.output,
		empty: isEmpty,
		wikiContext,
		savedToWiki,
	};
}

// ── Display Helper ───────────────────────────────────────────────────────────

function displayExplain(
	diagram: string,
	summaries: ModuleSummary[],
	empty: boolean,
	aiSummary?: string,
): void {
	if (empty) {
		log.warning(
			"No dependency data found. Run `maina context` first to index the codebase.",
		);
		return;
	}

	log.info("Dependency Diagram:");
	log.message(`\`\`\`mermaid\n${diagram}\`\`\``);

	if (summaries.length > 0) {
		log.info("");
		log.info("Module Summary:");
		log.message(formatSummaryTable(summaries));
	}

	if (aiSummary) {
		log.info("");
		log.info("AI Summary:");
		log.message(aiSummary);
	}
}

// ── Commander Command ────────────────────────────────────────────────────────

export function explainCommand(): Command {
	return new Command("explain")
		.description("Visualize codebase structure with Mermaid diagrams")
		.option("--scope <dir>", "Limit to specific directory")
		.option("-o, --output <path>", "Write diagram to file")
		.option("--save", "Save explanation to wiki/raw/")
		.action(async (options) => {
			intro("maina explain");

			const result = await explainAction({
				scope: options.scope,
				output: options.output,
				save: options.save,
			});

			if (!result.displayed) {
				log.warning(result.reason ?? "Unknown error");
				outro("Done.");
				return;
			}

			if (result.wikiContext) {
				log.info("Wiki context found for scope, included in AI prompt.");
			}

			displayExplain(
				result.diagram ?? "",
				result.summaries ?? [],
				result.empty ?? false,
				result.aiSummary,
			);

			// Write to file if --output specified
			if (result.outputPath && result.diagram) {
				writeFileSync(result.outputPath, result.diagram);
				log.success(`Diagram written to ${result.outputPath}`);
			}

			if (result.savedToWiki) {
				log.success(`Explanation saved to ${result.savedToWiki}`);
			}

			outro("Done.");
		});
}
