/**
 * The Codex plugin (https://developers.openai.com/plugins/build/plugins):
 * the Agent Plugins 1.0 package plus Codex's `extensions["com.openai"]`
 * overlay, which points at the hooks and describes the plugin:
 *
 *   plugin.json        portable manifest + extensions["com.openai"]
 *   hooks/hooks.json   `${PLUGIN_ROOT}/launcher/launch.sh hook --host codex
 *                      <event>` (Codex gives plugin hooks PLUGIN_ROOT)
 *   mcp.json, skills/, launcher/
 *
 * Codex hooks fail open and have no fail-closed setting, so the gates run
 * synchronously and the launcher answers a deny (exit 2) itself when the
 * runtime is unavailable; Codex runs a tool whose hook answers `ask`.
 */

import { CODEX_HOOK_MAP } from "@mainahq/runtime/src/adapters/codex";
import type { PluginDefinition } from "../definition";
import { portableFiles, portableManifest } from "./agent-plugins";
import { file, json, LAUNCHER, matcherGroups } from "./shared";
import type { GeneratedFile, Sources } from "./types";

const HOOKS_FILE = "hooks/hooks.json";

/** A category from Codex's documented examples. */
const CATEGORY = "Productivity";

export function codex(
	definition: PluginDefinition,
	sources: Sources,
): readonly GeneratedFile[] {
	const manifest = {
		...portableManifest(definition, sources),
		extensions: {
			"com.openai": {
				hooks: `./${HOOKS_FILE}`,
				interface: {
					displayName: definition.displayName,
					shortDescription: definition.description,
					developerName: definition.author.name,
					category: CATEGORY,
					websiteURL: definition.homepage,
				},
			},
		},
	};
	const hooks = {
		hooks: matcherGroups(
			definition,
			CODEX_HOOK_MAP,
			`\${PLUGIN_ROOT}/${LAUNCHER}`,
			"codex",
		),
	};
	return [
		file("plugin.json", json(manifest)),
		file(HOOKS_FILE, json(hooks)),
		...portableFiles(definition, sources),
	];
}
