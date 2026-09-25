/**
 * Wiki Lint Runner — thin wrapper for verify pipeline integration.
 *
 * Checks if .maina/wiki/ exists, runs wiki lint, and converts
 * results to ToolReport-compatible format.
 */

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ProcessPort } from "../../ports/process";
import type { Finding } from "../diff-filter";
import { runWikiLint, wikiLintToFindings } from "./wiki-lint";

interface WikiLintRunnerOptions {
	cwd: string;
	mainaDir?: string;
	/** Spawns wiki lint's `git log`; the system adapter by default. */
	process?: ProcessPort;
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
	// The pipeline passes an absolute `<root>/.maina`; only a relative dir is
	// resolved against the root (joining an absolute one would double it).
	const wikiDir = join(
		isAbsolute(mainaDir) ? mainaDir : join(cwd, mainaDir),
		"wiki",
	);

	// Skip if wiki not initialized
	if (!existsSync(wikiDir)) {
		return { findings: [], skipped: true };
	}

	const result = await runWikiLint({
		wikiDir,
		repoRoot: cwd,
		process: options.process,
	});
	const findings = wikiLintToFindings(result);

	return { findings, skipped: false };
}
