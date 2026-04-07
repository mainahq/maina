/**
 * Wiki Post-Commit Hook — triggers incremental compilation after commits.
 *
 * Runs silently in the background. Never breaks the commit flow —
 * all errors are caught and swallowed.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { compile } from "./compiler";
import { loadState } from "./state";

/**
 * Post-commit hook for wiki incremental compilation.
 *
 * Checks if the wiki has been initialized (has .state.json),
 * then runs an incremental compile. Swallows all errors to
 * never break the commit flow.
 */
export async function onPostCommit(
	mainaDir: string,
	repoRoot: string,
): Promise<void> {
	try {
		const wikiDir = join(mainaDir, "wiki");

		// Skip if wiki directory does not exist
		if (!existsSync(wikiDir)) {
			return;
		}

		// Skip if wiki has not been initialized (no .state.json)
		const state = loadState(wikiDir);
		if (!state) {
			return;
		}

		// Run incremental compilation (not full)
		await compile({
			repoRoot,
			mainaDir,
			wikiDir,
			full: false,
			dryRun: false,
		});
	} catch {
		// Swallow all errors — never break the commit flow
	}
}
