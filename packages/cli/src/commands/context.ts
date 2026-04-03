import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import { assembleContext } from "@maina/core";
import { Command } from "commander";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatLayerTable(
	layers: {
		name: string;
		tokens: number;
		entries: number;
		included: boolean;
	}[],
): string {
	const header = `  ${"Layer".padEnd(12)} ${"Tokens".padStart(6)}  ${"Entries".padStart(7)}  Status`;
	const separator = `  ${"─".repeat(12)} ${"─".repeat(6)}  ${"─".repeat(7)}  ${"─".repeat(8)}`;
	const rows = layers.map((l) => {
		const status = l.included ? "included" : "excluded";
		return `  ${l.name.padEnd(12)} ${String(l.tokens).padStart(6)}  ${String(l.entries).padStart(7)}  ${status}`;
	});
	return [header, separator, ...rows].join("\n");
}

function formatSummary(result: {
	tokens: number;
	mode: string;
	budget: { total: number };
}): string {
	const usage =
		result.budget.total > 0
			? `${((result.tokens / result.budget.total) * 100).toFixed(1)}%`
			: "N/A";
	return `Mode: ${result.mode} | Tokens: ${result.tokens} / ${result.budget.total} (${usage})`;
}

// ── Command factory ───────────────────────────────────────────────────────────

export function contextCommand(): Command {
	const cmd = new Command("context")
		.description("Generate focused codebase context")
		.option("--scope <dir>", "Limit to specific directory")
		.option("--show", "Show layer report only")
		.option("--mode <mode>", "Budget mode: explore|focused|default", "explore")
		.action(async (options) => {
			intro("maina context");

			const repoRoot = process.cwd();
			const mainaDir = join(repoRoot, ".maina");

			const s = spinner();
			s.start("Assembling context…");

			const modeOverride =
				options.mode !== "explore" ? options.mode : undefined;
			const result = await assembleContext("context", {
				repoRoot,
				mainaDir,
				scope: options.scope,
				modeOverride,
			});

			s.stop("Context assembled.");

			log.info(formatSummary(result));
			log.message(formatLayerTable(result.layers));

			if (!options.show) {
				const outputPath = join(repoRoot, "CONTEXT.md");
				await Bun.write(outputPath, result.text);
				log.success(`Written to ${outputPath}`);
			}

			outro("Done.");
		});

	// Subcommand: context add <file>
	cmd
		.command("add <file>")
		.description("Add file to semantic custom context")
		.action(async (file: string) => {
			intro("maina context add");

			const repoRoot = process.cwd();
			const mainaDir = join(repoRoot, ".maina");
			const destDir = join(mainaDir, "context", "semantic", "custom");

			try {
				mkdirSync(destDir, { recursive: true });

				const srcFile = Bun.file(file);
				if (!(await srcFile.exists())) {
					log.error(`File not found: ${file}`);
					outro("Aborted.");
					return;
				}

				const content = await srcFile.text();
				const destPath = join(destDir, basename(file));
				await Bun.write(destPath, content);
				log.success(`Added ${basename(file)} to custom context.`);
				outro("Done.");
			} catch {
				outro("Aborted.");
			}
		});

	// Subcommand: context show
	cmd
		.command("show")
		.description("Show context layers with token counts")
		.action(async () => {
			intro("maina context show");

			const repoRoot = process.cwd();
			const mainaDir = join(repoRoot, ".maina");

			const s = spinner();
			s.start("Loading context layers…");

			const result = await assembleContext("context", {
				repoRoot,
				mainaDir,
			});

			s.stop("Layers loaded.");

			log.info(formatSummary(result));
			log.message(formatLayerTable(result.layers));

			outro("Done.");
		});

	return cmd;
}
