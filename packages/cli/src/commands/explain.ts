import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import {
	generateDependencyDiagram,
	generateModuleSummary,
	type ModuleSummary,
} from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExplainActionOptions {
	scope?: string;
	output?: string;
	cwd?: string;
}

export interface ExplainActionResult {
	displayed: boolean;
	reason?: string;
	diagram?: string;
	summaries?: ModuleSummary[];
	outputPath?: string;
	empty?: boolean;
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

	return {
		displayed: true,
		diagram,
		summaries,
		outputPath: options.output,
		empty: isEmpty,
	};
}

// ── Display Helper ───────────────────────────────────────────────────────────

function displayExplain(
	diagram: string,
	summaries: ModuleSummary[],
	empty: boolean,
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
}

// ── Commander Command ────────────────────────────────────────────────────────

export function explainCommand(): Command {
	return new Command("explain")
		.description("Visualize codebase structure with Mermaid diagrams")
		.option("--scope <dir>", "Limit to specific directory")
		.option("-o, --output <path>", "Write diagram to file")
		.action(async (options) => {
			intro("maina explain");

			const result = await explainAction({
				scope: options.scope,
				output: options.output,
			});

			if (!result.displayed) {
				log.warning(result.reason ?? "Unknown error");
				outro("Done.");
				return;
			}

			displayExplain(
				result.diagram ?? "",
				result.summaries ?? [],
				result.empty ?? false,
			);

			// Write to file if --output specified
			if (result.outputPath && result.diagram) {
				writeFileSync(result.outputPath, result.diagram);
				log.success(`Diagram written to ${result.outputPath}`);
			}

			outro("Done.");
		});
}
