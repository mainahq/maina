/**
 * What every MCP prompt shares (FR-MCP-3). A prompt is a definition: its
 * string arguments, the tools its text tells the host to call, and a pure
 * `render` from arguments to text. The server registers a prompt only when
 * every tool it names is registered, so a rendered prompt never points the
 * host at a tool this server does not serve.
 */

import { z } from "zod";
import type { ToolName } from "../allowlist";

/** Prompt arguments as a client sends them: strings, absent when not given. */
export type PromptArgs = Readonly<Record<string, string | undefined>>;

export type PromptDefinition = Readonly<{
	name: string;
	title: string;
	description: string;
	/** Argument schemas; MCP prompt arguments are always strings. */
	args: Readonly<Record<string, z.ZodString | z.ZodOptional<z.ZodString>>>;
	/** Every tool `render` can name, for any arguments. */
	tools: readonly ToolName[];
	render: (args: PromptArgs) => string;
}>;

export const optionalArg = (description: string) =>
	z.string().optional().describe(description);

export const requiredArg = (description: string) =>
	z.string().trim().min(1).describe(description);

/**
 * An optional git ref. A rendered prompt puts it in a shell command the
 * host may run, so it is limited to ref characters and never starts with
 * `-` (an option), `~` (tilde expansion) or `^`. Blank counts as absent,
 * like `arg`, because clients send unfilled optional arguments as "".
 */
export const refArg = (description: string) =>
	z
		.string()
		.regex(
			/^\s*(?:(?![-~^])[A-Za-z0-9._/@^~+-]+)?\s*$/,
			"base must be a plain git ref",
		)
		.optional()
		.describe(description);

/** "the `verify` tool": the one way a prompt names a tool, typed against the catalog. */
export const tool = (name: ToolName): string => `the \`${name}\` tool`;

/** A trimmed argument, or `undefined` when it is absent or blank. */
export function arg(args: PromptArgs, name: string): string | undefined {
	const value = args[name]?.trim();
	return value ? value : undefined;
}

/** A comma- or newline-separated argument as a list, blanks dropped. */
export function list(args: PromptArgs, name: string): string[] | undefined {
	const items = (args[name] ?? "")
		.split(/[,\n]/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	return items.length > 0 ? items : undefined;
}

/** A value as the JSON a host passes straight into a tool argument. */
export const json = (value: unknown): string => JSON.stringify(value);

/** Numbered steps, one per line. */
export const steps = (items: readonly string[]): string =>
	items.map((item, i) => `${i + 1}. ${item}`).join("\n");
