/**
 * `generate(host)`: one host's plugin package from the single definition.
 * Pure: the files it bundles come in as `Sources` (read by `../sources.ts`),
 * and `scripts/generate.ts` writes the result to `dist/<host>/`.
 */

import { PLUGIN, type PluginDefinition } from "../definition";
import { agentPlugins } from "./agent-plugins";
import { claude } from "./claude";
import { codex } from "./codex";
import { cursor } from "./cursor";
import type { GeneratedFile, Host, Sources } from "./types";

export type { GeneratedFile, Host, Sources } from "./types";

export const HOSTS: readonly Host[] = [
	"claude",
	"cursor",
	"codex",
	"agent-plugins",
];

const GENERATORS: Readonly<
	Record<
		Host,
		(definition: PluginDefinition, sources: Sources) => readonly GeneratedFile[]
	>
> = {
	claude,
	cursor,
	codex,
	"agent-plugins": agentPlugins,
};

export function generate(
	host: Host,
	sources: Sources,
	definition: PluginDefinition = PLUGIN,
): readonly GeneratedFile[] {
	return GENERATORS[host](definition, sources);
}
