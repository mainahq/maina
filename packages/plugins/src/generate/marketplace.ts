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
import { CODEX_CATEGORY } from "./codex";
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

/**
 * The Cursor listing (v1 task 9.3; https://cursor.com/docs/reference/plugins,
 * https://cursor.com/docs/plugins): a multi-plugin repo's
 * `.cursor-plugin/marketplace.json`. The Cursor Marketplace submission
 * points at it, and a team that cannot wait for review imports the repo as
 * a Team Marketplace (Dashboard, Plugins & MCPs, Import from Repo), which
 * reads the same file and re-reads it on each push with Auto Refresh.
 * Like the Claude Code entry, it pins no version.
 */
export const CURSOR_MARKETPLACE_PATH = ".cursor-plugin/marketplace.json";

/** The generated Cursor package, from the repo root. */
export const CURSOR_PLUGIN_SOURCE = "./packages/plugins/dist/cursor";

export function cursorMarketplace(definition: PluginDefinition): GeneratedFile {
	const listing = {
		name: definition.name,
		owner: { name: definition.author.name },
		metadata: { description: definition.description },
		plugins: [
			{
				name: definition.name,
				source: CURSOR_PLUGIN_SOURCE,
				description: definition.description,
				author: { name: definition.author.name },
				homepage: definition.homepage,
				repository: definition.repository,
				license: definition.license,
				keywords: definition.keywords,
				category: "security",
			},
		],
	};
	return file(CURSOR_MARKETPLACE_PATH, json(listing));
}

/**
 * The Codex listing (v1 task 9.4; https://developers.openai.com/codex/plugins/build):
 * Codex reads a repo's marketplace from `.agents/plugins/marketplace.json`
 * at its root, and `/plugins` installs an entry from its `local` source, a
 * folder relative to that root. Users choose to install maina
 * (`AVAILABLE`), and it needs no sign-in, so authentication happens, if
 * ever, on install. Like the other listings, it pins no version.
 */
export const CODEX_MARKETPLACE_PATH = ".agents/plugins/marketplace.json";

/** The generated Codex package, from the repo root. */
export const CODEX_PLUGIN_SOURCE = "./packages/plugins/dist/codex";

export function codexMarketplace(definition: PluginDefinition): GeneratedFile {
	const listing = {
		name: definition.name,
		interface: { displayName: definition.displayName },
		plugins: [
			{
				name: definition.name,
				source: { source: "local", path: CODEX_PLUGIN_SOURCE },
				policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
				category: CODEX_CATEGORY,
			},
		],
	};
	return file(CODEX_MARKETPLACE_PATH, json(listing));
}
