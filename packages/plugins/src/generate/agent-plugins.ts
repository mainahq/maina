/**
 * The Agent Plugins 1.0 package (https://agent-plugins.org/specification),
 * read by VS Code agent mode and Copilot, and the base the Codex plugin
 * extends:
 *
 *   plugin.json   the portable manifest
 *   mcp.json      the launcher in mcp mode; a `./` command resolves against
 *                 the plugin root (the spec expands nothing in `command`),
 *                 which is also where it runs, so the server finds the
 *                 project from the client's MCP roots (#344)
 *   skills/, launcher/
 *
 * The 1.0 core defines no hooks, commands or agents (they belong to client
 * extension namespaces), so this package has none.
 */

import type { PluginDefinition } from "../definition";
import {
	file,
	json,
	LAUNCHER,
	launcherFiles,
	RELATIVE_CLI,
	skillFiles,
} from "./shared";
import type { GeneratedFile, Sources } from "./types";

const PLUGIN_SCHEMA =
	"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

/** The portable manifest fields, before any client extension. */
export const portableManifest = (
	definition: PluginDefinition,
	sources: Sources,
) => ({
	$schema: PLUGIN_SCHEMA,
	name: definition.name,
	version: sources.version,
	description: definition.description,
	author: definition.author,
	homepage: definition.homepage,
	repository: definition.repository,
	license: definition.license,
	keywords: definition.keywords,
});

/** mcp.json, the skills and the launcher: what every Agent Plugins client loads. */
export const portableFiles = (
	definition: PluginDefinition,
	sources: Sources,
): readonly GeneratedFile[] => [
	file(
		"mcp.json",
		json({
			$schema: MCP_SCHEMA,
			mcpServers: {
				[definition.mcpServer]: {
					type: "stdio",
					command: `./${LAUNCHER}`,
					args: ["mcp"],
				},
			},
		}),
	),
	...skillFiles(sources, RELATIVE_CLI),
	...launcherFiles(sources),
];

export function agentPlugins(
	definition: PluginDefinition,
	sources: Sources,
): readonly GeneratedFile[] {
	return [
		file("plugin.json", json(portableManifest(definition, sources))),
		...portableFiles(definition, sources),
	];
}
