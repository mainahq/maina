import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import { loadDefault, type PromptTask } from "@maina/core";
import { Command } from "commander";

const TASKS: PromptTask[] = [
	"review",
	"commit",
	"tests",
	"fix",
	"explain",
	"design",
	"context",
];

export function promptCommand(): Command {
	const cmd = new Command("prompt").description(
		"Manage prompt templates and versions",
	);

	// prompt edit <task>
	cmd
		.command("edit <task>")
		.description("Open prompt template in $EDITOR")
		.action(async (task: string) => {
			intro("maina prompt edit");

			const repoRoot = process.cwd();
			const mainaDir = join(repoRoot, ".maina");
			const promptsDir = join(mainaDir, "prompts");
			const filePath = join(promptsDir, `${task}.md`);

			mkdirSync(promptsDir, { recursive: true });

			// Create from default template if doesn't exist
			const file = Bun.file(filePath);
			if (!(await file.exists())) {
				const defaultContent = await loadDefault(task as PromptTask);
				await Bun.write(filePath, defaultContent);
				log.info(`Created ${task}.md from default template.`);
			}

			const editor = process.env.EDITOR || "vi";
			const proc = Bun.spawn([editor, filePath], {
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			});
			await proc.exited;

			outro("Done.");
		});

	// prompt list
	cmd
		.command("list")
		.description("Show all prompt tasks with version info")
		.action(async () => {
			intro("maina prompt list");

			const repoRoot = process.cwd();
			const mainaDir = join(repoRoot, ".maina");

			const s = spinner();
			s.start("Loading prompt info…");

			// TODO(#sprint-10): Wire getPromptStats(mainaDir) once feedback query is fixed
			s.stop("Loaded.");

			const header = `  ${"Task".padEnd(12)} ${"Usage".padStart(7)}  ${"Accept".padStart(8)}  Override`;
			const separator = `  ${"─".repeat(12)} ${"─".repeat(7)}  ${"─".repeat(8)}  ${"─".repeat(8)}`;

			const rows: string[] = [];
			for (const task of TASKS) {
				const overridePath = join(mainaDir, "prompts", `${task}.md`);
				const hasOverride = await Bun.file(overridePath).exists();

				// Stats matching requires feedback table query by command, not prompt hash prefix
				// TODO(#sprint-10): Fix stats display with proper feedback query
				const usageStr = "\u2014";
				const rateStr = "\u2014";
				const overrideStr = hasOverride ? "yes" : "no";

				rows.push(
					`  ${task.padEnd(12)} ${usageStr.padStart(7)}  ${rateStr.padStart(8)}  ${overrideStr.padStart(8)}`,
				);
			}

			log.message([header, separator, ...rows].join("\n"));
			outro("Done.");
		});

	return cmd;
}
