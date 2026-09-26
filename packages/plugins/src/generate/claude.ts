/**
 * The Claude Code plugin (https://code.claude.com/docs/en/plugins-reference):
 *
 *   .claude-plugin/plugin.json   metadata; components load from their
 *                                default locations below
 *   hooks/hooks.json             `"${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh"
 *                                hook --host claude <event>`
 *   .mcp.json                    the launcher in mcp mode
 *   skills/, commands/, agents/, launcher/
 *
 * Claude Code has no fail-closed hook setting (a crash or timeout lets the
 * action proceed), so the gates run synchronously and the launcher prints
 * the fail-closed answer itself when the runtime is unavailable.
 */

import { CLAUDE_HOOK_MAP } from "@mainahq/runtime/src/adapters/claude-code";
import type { PluginDefinition } from "../definition";
import {
	commandAndAgentFiles,
	file,
	json,
	LAUNCHER,
	launcherFiles,
	matcherGroups,
	skillFiles,
} from "./shared";
import type { GeneratedFile, Sources } from "./types";

const ROOT = `\${CLAUDE_PLUGIN_ROOT}`;

/** Quoted, so a plugin root with a space stays one word (shell-form hooks). */
const HOOK_LAUNCHER = `"${ROOT}/${LAUNCHER}"`;

/** Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` in skill bodies. */
const CLI = `"${ROOT}/${LAUNCHER}" cli`;

export function claude(
	definition: PluginDefinition,
	sources: Sources,
): readonly GeneratedFile[] {
	const manifest = {
		name: definition.name,
		displayName: definition.displayName,
		version: sources.version,
		description: definition.description,
		author: definition.author,
		homepage: definition.homepage,
		repository: definition.repository,
		license: definition.license,
		keywords: definition.keywords,
	};
	const hooks = {
		description: `${definition.displayName} guardrails: every hook runs the bundled launcher, which fails closed.`,
		hooks: matcherGroups(definition, CLAUDE_HOOK_MAP, HOOK_LAUNCHER, "claude"),
	};
	const mcp = {
		mcpServers: {
			[definition.mcpServer]: { command: `${ROOT}/${LAUNCHER}`, args: ["mcp"] },
		},
	};
	return [
		file(".claude-plugin/plugin.json", json(manifest)),
		file("hooks/hooks.json", json(hooks)),
		file(".mcp.json", json(mcp)),
		...skillFiles(sources, { command: CLI }),
		...commandAndAgentFiles(definition),
		...launcherFiles(sources),
	];
}
