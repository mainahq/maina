/**
 * The Claude Code marketplace listing (v1 task 9.2;
 * https://code.claude.com/docs/en/plugin-marketplaces). Pure: no I/O.
 *
 * `/plugin marketplace add mainahq/maina` clones the repo and reads
 * `.claude-plugin/marketplace.json` at its root; `/plugin install
 * maina@maina` copies the package its entry points at. The entry's source
 * is the generated Claude Code package, relative to the repo root, and it
 * pins no version: plugin.json carries the one version (the runtime's), and
 * Claude Code silently prefers it over a second copy that could drift.
 */

import type { PluginDefinition } from "../definition";
import { file, json } from "./shared";
import type { GeneratedFile } from "./types";

/** Where Claude Code reads the listing, from the repo root. */
export const CLAUDE_MARKETPLACE_PATH = ".claude-plugin/marketplace.json";

/** The generated Claude Code package, from the repo root. */
export const CLAUDE_PLUGIN_SOURCE = "./packages/plugins/dist/claude";

export function claudeMarketplace(definition: PluginDefinition): GeneratedFile {
	const listing = {
		name: definition.name,
		owner: { name: definition.author.name },
		metadata: { description: definition.description },
		plugins: [
			{
				name: definition.name,
				source: CLAUDE_PLUGIN_SOURCE,
				description: definition.description,
				author: definition.author,
				homepage: definition.homepage,
				repository: definition.repository,
				license: definition.license,
				keywords: definition.keywords,
				category: "security",
			},
		],
	};
	return file(CLAUDE_MARKETPLACE_PATH, json(listing));
}
