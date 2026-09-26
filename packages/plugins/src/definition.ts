/**
 * The maina plugin, defined once (v1 task 9.1, spec §5, Global Constraint 4).
 *
 * Every host package in `dist/` is generated from this: the generators in
 * `./generate/` only translate it into each host's layout and wire names.
 * Nothing here is host-specific. Hooks are listed by lifecycle event; each
 * host's runtime adapter maps an event to the host's documented native
 * events (`HostHookMap`, defined once, next to the events the adapter
 * answers), and every hook runs the bundled launcher as
 * `launch hook --host <host> <native event>` (#487). Pure data: no I/O.
 */

import type { LifecycleEvent } from "@mainahq/runtime/src/adapters/hook-map";

export type HookSpec = Readonly<{
	event: LifecycleEvent;
	/**
	 * The hook gates an action, so a hook that crashes or times out must
	 * block it (fail closed) rather than let it through.
	 */
	blocking: boolean;
}>;

/** A slash command or subagent, as Markdown with a description. */
export type MarkdownEntry = Readonly<{
	name: string;
	description: string;
	body: string;
}>;

export type PluginDefinition = Readonly<{
	/** Kebab-case identifier: every host namespaces components under it. */
	name: string;
	displayName: string;
	description: string;
	author: Readonly<{ name: string; url: string }>;
	homepage: string;
	repository: string;
	license: string;
	keywords: readonly string[];
	/** Skill folders of `packages/skills`, each holding a `SKILL.md`. */
	skills: readonly string[];
	hooks: readonly HookSpec[];
	/** The MCP server's name in each host's MCP config. */
	mcpServer: string;
	commands: readonly MarkdownEntry[];
	agents: readonly MarkdownEntry[];
}>;

export const PLUGIN: PluginDefinition = {
	name: "maina",
	displayName: "Maina",
	description:
		"Verification-first guardrails for AI coding agents: gates risky actions, verifies changes and reviews diffs before they merge.",
	author: { name: "Maina", url: "https://mainahq.com/" },
	homepage: "https://mainahq.com/",
	repository: "https://github.com/mainahq/maina",
	license: "Apache-2.0",
	keywords: ["verification", "guardrails", "code-review", "mcp", "tdd"],
	skills: [
		"onboarding",
		"verification-workflow",
		"code-review",
		"tdd",
		"plan-writing",
		"context-generation",
		"wiki-workflow",
		"cloud-workflow",
	],
	hooks: [
		{ event: "session.start", blocking: false },
		{ event: "tool.before", blocking: true },
		{ event: "permission.request", blocking: true },
		{ event: "file.edited", blocking: false },
		{ event: "session.stop", blocking: false },
	],
	mcpServer: "maina",
	commands: [],
	agents: [],
};
