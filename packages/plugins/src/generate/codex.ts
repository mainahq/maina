/**
 * The Codex plugin (https://developers.openai.com/plugins/build/plugins):
 * the Agent Plugins 1.0 package plus Codex's `extensions["com.openai"]`
 * overlay, which points at the hooks and describes the plugin:
 *
 *   plugin.json        portable manifest + extensions["com.openai"]
 *   hooks/hooks.json   `${PLUGIN_ROOT}/launcher/launch.sh hook --host codex
 *                      <event>` (Codex gives plugin hooks PLUGIN_ROOT)
 *   rules/maina.rules  Codex's command policy (execpolicy `prefix_rule`s),
 *                      the definition's shell rules through the Codex rules
 *                      emitter (task 4.5)
 *   mcp.json, skills/, launcher/
 *
 * Codex hooks fail open and have no fail-closed setting, so the gates run
 * synchronously and the launcher answers a deny (exit 2) itself when the
 * runtime is unavailable; Codex runs a tool whose hook answers `ask`. A
 * hook that crashes still lets its command through, which the rules file
 * covers for the commands maina never lets an agent run: Codex checks its
 * rules before any hook. Codex loads them once the user trusts the
 * project.
 */

import { emitCodexRules } from "@mainahq/cli/src/hosts/codex-rules";
import { CODEX_HOOK_MAP } from "@mainahq/runtime/src/adapters/codex";
import type { PluginDefinition, ShellRule } from "../definition";
import { portableFiles, portableManifest } from "./agent-plugins";
import { file, json, LAUNCHER, matcherGroups } from "./shared";
import type { GeneratedFile, Sources } from "./types";

const HOOKS_FILE = "hooks/hooks.json";

/** A category from Codex's documented examples. */
export const CODEX_CATEGORY = "Productivity";

/** The definition's shell rules as policy rules of the `shell` kind. */
const shellPolicy = (rules: readonly ShellRule[]) =>
	rules.map((rule) => ({ ...rule, kind: "shell" as const }));

/** The Codex `.rules` file for the definition's shell rules. */
const rulesFile = (definition: PluginDefinition): GeneratedFile =>
	file(
		`rules/${definition.name}.rules`,
		emitCodexRules({
			rules: {
				allow: shellPolicy(definition.shellRules.allow),
				deny: shellPolicy(definition.shellRules.deny),
			},
		}),
	);

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
					category: CODEX_CATEGORY,
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
		rulesFile(definition),
		...portableFiles(definition, sources),
	];
}
