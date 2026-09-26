/**
 * The Cursor plugin (https://cursor.com/docs/reference/plugins):
 *
 *   .cursor-plugin/plugin.json   metadata; components load from their
 *                                default locations below
 *   hooks/hooks.json             `./launcher/launch.sh hook --host cursor
 *                                <event>`, relative to the plugin root as
 *                                the reference's example is
 *   mcp.json                     the launcher in mcp mode
 *   rules/<name>.mdc             the definition's rules, with Cursor's
 *                                front matter
 *   skills/, commands/, agents/, launcher/
 *
 * Cursor hooks fail open unless `failClosed` is set, so every blocking hook
 * sets it; an observer that crashes does not hold up the session.
 *
 * Cursor gives a plugin no data dir (Claude Code has `CLAUDE_PLUGIN_DATA`,
 * Codex `PLUGIN_DATA`), so the launcher would cache the runtime, and the
 * runtime keep its socket and pid file, under `~/.maina`, which
 * uninstalling the plugin leaves behind with the runtime still running.
 * The hooks and the MCP server set `PLUGIN_DATA` to `data/` in the plugin
 * root instead: the hooks from the directory they run in (the plugin
 * root), the MCP server through `${CURSOR_PLUGIN_ROOT}`, which Cursor
 * expands in env values. Uninstalling removes it, and the runtime stops
 * once its pid file is gone.
 */

import { CURSOR_HOOK_MAP } from "@mainahq/runtime/src/adapters/cursor";
import type { PluginDefinition, RuleEntry } from "../definition";
import {
	byEvent,
	commandAndAgentFiles,
	file,
	hookCommand,
	json,
	LAUNCHER,
	launcherFiles,
	nativeHooks,
	RELATIVE_CLI,
	skillFiles,
} from "./shared";
import type { GeneratedFile, Sources } from "./types";

type HookEntry = Readonly<{ command: string; failClosed?: true }>;

/** The plugin's data dir, from its root. */
const DATA_DIR = "data";

/** A hook runs in the plugin root; `$PWD` keeps the path absolute. */
const HOOK_LAUNCHER = `PLUGIN_DATA="$PWD/${DATA_DIR}" ./${LAUNCHER}`;

const ROOT = `\${CURSOR_PLUGIN_ROOT}`;

/**
 * Words YAML (1.1 or 1.2) reads as a boolean or null. Starting with a
 * letter already rules out numbers in any base, dates and `~`.
 */
const YAML_KEYWORD = /^(?:true|false|yes|no|on|off|y|n|null)$/i;

/**
 * A YAML scalar: plain when that reads back as the same string (a letter
 * first, no edge whitespace, no indicator characters, not a keyword),
 * double-quoted otherwise.
 */
const yamlString = (value: string): string =>
	/^[A-Za-z](?:[A-Za-z0-9 ,.()'/-]*[A-Za-z0-9,.()'/-])?$/.test(value) &&
	!YAML_KEYWORD.test(value)
		? value
		: JSON.stringify(value);

/** A rule as a `.mdc` file: Cursor's front matter, then the Markdown. */
function ruleFile(rule: RuleEntry): GeneratedFile {
	const scope =
		rule.alwaysApply === true
			? "alwaysApply: true\n"
			: `globs:\n${rule.globs.map((g) => `  - ${yamlString(g)}\n`).join("")}`;
	return file(
		`rules/${rule.name}.mdc`,
		`---\ndescription: ${yamlString(rule.description)}\n${scope}---\n\n${rule.body.trimEnd()}\n`,
	);
}

export function cursor(
	definition: PluginDefinition,
	sources: Sources,
): readonly GeneratedFile[] {
	const manifest = {
		name: definition.name,
		description: definition.description,
		version: sources.version,
		author: { name: definition.author.name },
		homepage: definition.homepage,
		repository: definition.repository,
		license: definition.license,
		keywords: definition.keywords,
	};
	const hooks = {
		version: 1,
		hooks: byEvent(
			nativeHooks(definition, CURSOR_HOOK_MAP).map(({ event, blocking }) => {
				const command = hookCommand(HOOK_LAUNCHER, "cursor", event);
				const entry: HookEntry = blocking
					? { command, failClosed: true }
					: { command };
				return { event, entry };
			}),
		),
	};
	const mcp = {
		mcpServers: {
			[definition.mcpServer]: {
				command: `${ROOT}/${LAUNCHER}`,
				args: ["mcp"],
				env: { PLUGIN_DATA: `${ROOT}/${DATA_DIR}` },
			},
		},
	};
	return [
		file(".cursor-plugin/plugin.json", json(manifest)),
		file("hooks/hooks.json", json(hooks)),
		file("mcp.json", json(mcp)),
		...definition.rules.map(ruleFile),
		...skillFiles(sources, RELATIVE_CLI),
		...commandAndAgentFiles(definition),
		...launcherFiles(sources),
	];
}
