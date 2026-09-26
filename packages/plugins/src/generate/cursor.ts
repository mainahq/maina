/**
 * The Cursor plugin (https://cursor.com/docs/reference/plugins):
 *
 *   .cursor-plugin/plugin.json   metadata; components load from their
 *                                default locations below
 *   hooks/hooks.json             `./launcher/launch.sh hook --host cursor
 *                                <event>`, relative to the plugin root as
 *                                the reference's example is
 *   mcp.json                     the launcher in mcp mode
 *   skills/, commands/, agents/, launcher/
 *
 * Cursor hooks fail open unless `failClosed` is set, so every blocking hook
 * sets it; an observer that crashes does not hold up the session.
 */

import { CURSOR_HOOK_MAP } from "@mainahq/runtime/src/adapters/cursor";
import type { PluginDefinition } from "../definition";
import {
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
		hooks: Object.fromEntries(
			nativeHooks(definition, CURSOR_HOOK_MAP).map(
				({ event, blocking }): [string, readonly HookEntry[]] => {
					const command = hookCommand(`./${LAUNCHER}`, "cursor", event);
					return [
						event,
						[blocking ? { command, failClosed: true } : { command }],
					];
				},
			),
		),
	};
	const mcp = {
		mcpServers: {
			[definition.mcpServer]: {
				command: `\${CURSOR_PLUGIN_ROOT}/${LAUNCHER}`,
				args: ["mcp"],
			},
		},
	};
	return [
		file(".cursor-plugin/plugin.json", json(manifest)),
		file("hooks/hooks.json", json(hooks)),
		file("mcp.json", json(mcp)),
		...skillFiles(sources, RELATIVE_CLI),
		...commandAndAgentFiles(definition),
		...launcherFiles(sources),
	];
}
