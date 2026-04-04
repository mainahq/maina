import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import {
	appendWorkflowStep,
	detectWebProject,
	loadVisualConfig,
	updateBaselines,
} from "@maina/core";
import { Command } from "commander";

export interface VisualActionOptions {
	cwd?: string;
}

export interface VisualActionResult {
	updated: string[];
	errors: string[];
}

export async function visualUpdateAction(
	options: VisualActionOptions,
): Promise<VisualActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");

	if (!detectWebProject(cwd)) {
		log.warn("Not a web project — no dev server detected in package.json.");
		return { updated: [], errors: ["Not a web project"] };
	}

	const config = loadVisualConfig(mainaDir);

	if (config.urls.length === 0) {
		log.warn(
			'No URLs configured. Add "visual.urls" to .maina/preferences.json.',
		);
		return { updated: [], errors: ["No URLs configured"] };
	}

	const result = await updateBaselines(mainaDir, config);

	return result;
}

export function visualCommand(): Command {
	const cmd = new Command("visual").description(
		"Visual verification management",
	);

	cmd
		.command("update")
		.description("Capture current screenshots as baselines")
		.action(async () => {
			intro("maina visual update");

			const s = spinner();
			s.start("Capturing baseline screenshots…");

			const result = await visualUpdateAction({});

			s.stop("Capture complete.");

			if (result.updated.length > 0) {
				for (const file of result.updated) {
					log.success(`  Updated: ${file}`);
				}
			}

			if (result.errors.length > 0) {
				for (const error of result.errors) {
					log.error(`  Error: ${error}`);
				}
			}

			const mainaDir = join(process.cwd(), ".maina");
			appendWorkflowStep(
				mainaDir,
				"visual-update",
				`Updated ${result.updated.length} baseline(s). ${result.errors.length} error(s).`,
			);

			if (result.updated.length > 0) {
				outro(
					`${result.updated.length} baseline(s) updated. Commit them to git.`,
				);
			} else {
				outro("No baselines updated.");
			}
		});

	return cmd;
}
