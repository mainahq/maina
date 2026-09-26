/**
 * What every host generator shares. Pure: no I/O.
 *
 * A plugin never runs `maina` from PATH, `bunx` or `npx`: a GUI-launched
 * host has a stripped PATH (P2) and a registry spawn can hit an unpublished
 * pin (P3). Hooks, the MCP server and the skills' CLI references all go
 * through the launcher bundled at `launcher/launch.sh` (task 2.3), which
 * installs and runs the pinned runtime, and fails closed when it cannot.
 */

import type {
	HostHookMap,
	NativeHook,
} from "@mainahq/runtime/src/adapters/hook-map";
import type { MarkdownEntry, PluginDefinition } from "../definition";
import type { GeneratedFile, Sources } from "./types";

/** Where the launcher sits in every plugin package, from the plugin root. */
export const LAUNCHER = "launcher/launch.sh";

export const json = (value: unknown): string =>
	`${JSON.stringify(value, null, 2)}\n`;

export const file = (
	path: string,
	content: string,
	executable = false,
): GeneratedFile => ({ path, content, executable });

/** The launcher files, under `launcher/`. */
export const launcherFiles = (sources: Sources): readonly GeneratedFile[] =>
	sources.launcher.map((f) =>
		file(`launcher/${f.path}`, f.content, f.executable),
	);

/** `launch hook --host <host> <event>`: the runtime routes on the host (#487). */
export const hookCommand = (
	launcher: string,
	host: string,
	event: string,
): string => `${launcher} hook --host ${host} ${event}`;

/**
 * The definition's hooks as the host's native registrations (from the host
 * adapter's map), in definition order.
 */
export const nativeHooks = (
	definition: PluginDefinition,
	map: HostHookMap,
): readonly Readonly<NativeHook & { blocking: boolean }>[] =>
	definition.hooks.flatMap((spec) =>
		map[spec.event].map((native) => ({ ...native, blocking: spec.blocking })),
	);

/**
 * Entries keyed by native event, in first-seen order. Two lifecycle points
 * on one native event keep both entries: overwriting one would drop a gate.
 */
export function byEvent<T>(
	entries: readonly Readonly<{ event: string; entry: T }>[],
): Readonly<Record<string, readonly T[]>> {
	const events = [...new Set(entries.map((e) => e.event))];
	return Object.fromEntries(
		events.map((event) => [
			event,
			entries.filter((e) => e.event === event).map((e) => e.entry),
		]),
	);
}

type CommandHook = Readonly<{ type: "command"; command: string }>;
type MatcherGroup = Readonly<{
	matcher?: string;
	hooks: readonly CommandHook[];
}>;

/**
 * Claude Code and Codex share a hooks shape: event, then matcher groups,
 * then command handlers. Neither has a fail-closed setting, so a gate never
 * runs async and the launcher itself answers when the runtime cannot.
 */
export function matcherGroups(
	definition: PluginDefinition,
	map: HostHookMap,
	launcher: string,
	host: string,
): Readonly<Record<string, readonly MatcherGroup[]>> {
	return byEvent(
		nativeHooks(definition, map).map(({ event, matcher }) => {
			const hooks: readonly CommandHook[] = [
				{ type: "command", command: hookCommand(launcher, host, event) },
			];
			const entry: MatcherGroup =
				matcher === undefined ? { hooks } : { matcher, hooks };
			return { event, entry };
		}),
	);
}

// ── Skills ──────────────────────────────────────────────────────────────────

/** Prose that offers `npx` as an alternative; the launcher replaces both. */
const NPX_ALTERNATIVES: readonly RegExp[] = [
	/\s*Use `npx @mainahq\/cli` if `maina` is not installed globally\./g,
	/ \(or `npx @mainahq\/cli[^`]*`\)/g,
	/ or `npx @mainahq\/cli[^`]*`/g,
];

/** A `maina` or `npx @mainahq/cli` command inside code, as the launcher's cli mode. */
function rewriteCode(code: string, cli: string): string {
	return code
		.replace(/npx @mainahq\/cli(?=\s|$)/g, () => cli)
		.replace(
			/(^|[\s;&|(])maina(?=\s|$)/gm,
			(_, before: string) => before + cli,
		);
}

/** How a host's skills reach the CLI. */
type SkillCli = Readonly<{
	/** Replaces `maina` in the skills' code. */
	command: string;
	/** Added under the front matter, when the command needs explaining. */
	note?: string;
}>;

/**
 * For hosts that expand no plugin-root variable in a skill: the launcher by
 * its path from the skill's folder (`skills/<name>/`), which is where
 * Agent Skills resolves a skill's relative paths.
 */
export const RELATIVE_CLI: SkillCli = {
	command: `../../${LAUNCHER} cli`,
	note: `> This plugin bundles the maina CLI: run it as \`../../${LAUNCHER} cli <command>\`, a path relative to this skill's folder.\n`,
};

/** After the front matter, or at the top when there is none. */
function addNote(markdown: string, note: string | undefined): string {
	if (note === undefined) return markdown;
	const end = /^---\n[\s\S]*?\n---\n/.exec(markdown)?.[0].length ?? 0;
	return `${markdown.slice(0, end)}\n${note}${markdown.slice(end)}`;
}

/**
 * A skill as a plugin ships it: every CLI command in its code (inline spans
 * and fenced blocks) runs through the bundled launcher.
 */
function rewriteSkill(markdown: string, cli: SkillCli): string {
	const prose = NPX_ALTERNATIVES.reduce(
		(text, re) => text.replace(re, ""),
		markdown,
	);
	const rewritten = prose
		.replace(
			/^(```[^\n]*\n)([\s\S]*?)(^```)/gm,
			(_, open: string, body: string, close: string) =>
				open + rewriteCode(body, cli.command) + close,
		)
		.replace(
			/`([^`\n]+)`/g,
			(_, code: string) => `\`${rewriteCode(code, cli.command)}\``,
		);
	return addNote(rewritten, cli.note);
}

export const skillFiles = (
	sources: Sources,
	cli: SkillCli,
): readonly GeneratedFile[] =>
	sources.skills.map((skill) =>
		file(`skills/${skill.name}/SKILL.md`, rewriteSkill(skill.content, cli)),
	);

// ── Commands and agents ─────────────────────────────────────────────────────

const markdown = (frontmatter: string, body: string): string =>
	`---\n${frontmatter}---\n\n${body.trimEnd()}\n`;

/** Slash commands and subagents as Markdown under `commands/` and `agents/`. */
export const commandAndAgentFiles = (
	definition: PluginDefinition,
): readonly GeneratedFile[] => [
	...definition.commands.map((c: MarkdownEntry) =>
		file(
			`commands/${c.name}.md`,
			markdown(`description: ${c.description}\n`, c.body),
		),
	),
	...definition.agents.map((a: MarkdownEntry) =>
		file(
			`agents/${a.name}.md`,
			markdown(`name: ${a.name}\ndescription: ${a.description}\n`, a.body),
		),
	),
];
