/**
 * What every v2 tool shares: the `root` input, the `{ data, error, meta }`
 * structured output, the text summary beside it, and path normalisation
 * against an explicit root. A tool is a definition (schemas + `run`); the
 * server resolves the root, calls `run` and builds the MCP result here.
 */

import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Result } from "@mainahq/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolName } from "../allowlist";
import type { McpRuntime, RuntimeError } from "../runtime";

export const rootInput = z
	.string()
	.optional()
	.describe(
		"Absolute path of the repository to act on. Defaults to the root the server resolves for itself, normally the repository it was started in.",
	);

export const filesInput = z
	.array(z.string())
	.optional()
	.describe("Files to act on: repo-relative, or absolute inside the root.");

const errorSchema = z.object({
	kind: z.enum(["no_root", "invalid_input", "not_found", "failed"]),
	message: z.string(),
	path: z.string().optional(),
});

const metaSchema = z.object({
	tool: z.string(),
	root: z.string().nullable(),
	version: z.string(),
	durationMs: z.number(),
});

/** The structured output shape of a tool whose data is `data`. */
function envelope<T extends z.ZodType>(data: T) {
	return {
		data: data.nullable(),
		error: errorSchema.nullable(),
		meta: metaSchema,
	};
}

export type ToolContext = Readonly<{
	root: string;
	runtime: McpRuntime;
	/** The tools this server registered, in catalog order. */
	enabled: readonly ToolName[];
}>;

export type ToolSuccess = Readonly<{ data: unknown; summary: string }>;

export type ToolRun = (
	args: Readonly<Record<string, unknown>>,
	ctx: ToolContext,
) => Promise<Result<ToolSuccess, RuntimeError>>;

export type ToolDefinition = Readonly<{
	name: ToolName;
	description: string;
	readOnly: boolean;
	input: z.ZodRawShape;
	output: z.ZodRawShape;
	run: ToolRun;
}>;

/**
 * Types `run` against the tool's own input shape. The SDK validates the
 * arguments against `input` before the handler runs, so the cast is sound.
 */
export function defineTool<I extends z.ZodRawShape, O extends z.ZodType>(
	def: Readonly<{
		name: ToolName;
		description: string;
		readOnly: boolean;
		input: I;
		data: O;
		run: (
			args: z.infer<z.ZodObject<I>>,
			ctx: ToolContext,
		) => Promise<
			Result<Readonly<{ data: z.infer<O>; summary: string }>, RuntimeError>
		>;
	}>,
): ToolDefinition {
	return {
		name: def.name,
		description: def.description,
		readOnly: def.readOnly,
		input: def.input,
		output: envelope(def.data),
		run: def.run as ToolRun,
	};
}

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const invalid = (message: string): Result<never, RuntimeError> => ({
	ok: false,
	error: { kind: "invalid_input", message },
});

/** The MCP result for a tool that answered. */
export function successResult(
	name: string,
	meta: Readonly<{ root: string; version: string; durationMs: number }>,
	success: ToolSuccess,
): CallToolResult {
	return {
		content: [{ type: "text", text: success.summary }],
		structuredContent: {
			data: success.data as Record<string, unknown>,
			error: null,
			meta: { tool: name, ...meta },
		},
	};
}

/** The MCP result for a tool that could not answer. */
export function errorResult(
	name: string,
	meta: Readonly<{ root: string | null; version: string; durationMs: number }>,
	error: RuntimeError,
): CallToolResult {
	return {
		content: [{ type: "text", text: `${name}: ${error.message}` }],
		structuredContent: {
			data: null,
			error: { ...error },
			meta: { tool: name, ...meta },
		},
		isError: true,
	};
}

/**
 * `paths` as repo-relative, `/`-separated paths under `root`: relative
 * inputs resolve against the root (never the process cwd), absolute inputs
 * must sit inside it.
 */
export function repoRelative(
	root: string,
	paths: readonly string[],
): Result<string[], RuntimeError> {
	const out: string[] = [];
	for (const path of paths) {
		const abs = isAbsolute(path) ? path : resolve(root, path);
		// The root is usually git's top level, with symlinks resolved; an
		// absolute path spelled through a symlink (macOS /tmp, /var) is
		// still inside it.
		const rel = [relative(root, abs), relative(real(root), real(abs))].find(
			(r) => !outside(r),
		);
		if (rel === undefined) {
			return invalid(`${path} is outside the root ${root}`);
		}
		out.push(rel === "" ? "." : rel.split(sep).join("/"));
	}
	return ok(out);
}

const outside = (rel: string): boolean =>
	rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

/** `path` with symlinks resolved, or as given when it does not exist. */
function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/**
 * A git ref from a tool input: refused when it could be read as an option
 * (`--output=<file>` would make `git diff` write a file).
 */
export function checkRef(
	ref: string | undefined,
): Result<string | undefined, RuntimeError> {
	if (ref === undefined) return ok(undefined);
	return ref.trim().startsWith("-")
		? invalid(`base ${ref} is not a git ref`)
		: ok(ref);
}

/** `repoRelative` for an optional list: `undefined` stays `undefined`. */
export function optionalRepoRelative(
	root: string,
	paths: readonly string[] | undefined,
): Result<string[] | undefined, RuntimeError> {
	return paths === undefined ? ok(undefined) : repoRelative(root, paths);
}

/** "1 finding" / "2 findings". */
export const plural = (n: number, word: string): string =>
	`${n} ${word}${n === 1 ? "" : "s"}`;

/** At most `max` lines, with a note for the rest. */
export function capped(lines: readonly string[], max = 20): string[] {
	return lines.length <= max
		? [...lines]
		: [...lines.slice(0, max), `… and ${lines.length - max} more`];
}
