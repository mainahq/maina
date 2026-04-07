/**
 * Wiki Lint Runner — thin wrapper for verify pipeline integration.
 *
 * Checks if .maina/wiki/ exists, runs wiki lint, and converts
 * results to ToolReport-compatible format.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../diff-filter";
import { runWikiLint, wikiLintToFindings } from "./wiki-lint";

export interface WikiLintRunnerOptions {
	cwd: string;
	mainaDir?: string;
}

/**
 * Run wiki lint and return findings in the pipeline-compatible shape.
 * Auto-skips when .maina/wiki/ does not exist.
 */
export async function runWikiLintTool(
	options: WikiLintRunnerOptions,
): Promise<{ findings: Finding[]; skipped: boolean }> {
	const { cwd } = options;
	const mainaDir = options.mainaDir ?? ".maina";
	const wikiDir = join(cwd, mainaDir, "wiki");

	// Skip if wiki not initialized
	if (!existsSync(wikiDir)) {
		return { findings: [], skipped: true };
	}

	const result = runWikiLint({ wikiDir, repoRoot: cwd });
	const findings = wikiLintToFindings(result);

	return { findings, skipped: false };
}
