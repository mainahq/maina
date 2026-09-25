/**
 * The MCP tool catalog and allow-list (FR-MCP-2).
 *
 * A server registers the default set (at most eight tools) unless an
 * allow-list names others. The allow-list comes from the `--tools` flag,
 * else the `MAINA_MCP_TOOLS` env var: comma-separated tool names, where
 * `default` stands for the default set, so `default,ask_question` adds a
 * DeepWiki tool to it. Tools outside the list are never registered: the
 * server only calls the SDK's public `registerTool`, and nothing is pruned
 * afterwards.
 */

/** The v2 tools a server registers when no allow-list is given. */
export const DEFAULT_TOOLS = [
	"verify",
	"decide",
	"impact",
	"context",
	"review_triage",
	"spec_check",
	"receipt",
	"status",
] as const;

/** DeepWiki-compatible tools: registered only when allow-listed. */
export const DEEPWIKI_TOOLS = [
	"ask_question",
	"read_wiki_structure",
	"read_wiki_contents",
] as const;

/** Every tool a server can register, in listing order. */
export type ToolName =
	| (typeof DEFAULT_TOOLS)[number]
	| (typeof DEEPWIKI_TOOLS)[number];

export const ALL_TOOLS: readonly ToolName[] = [
	...DEFAULT_TOOLS,
	...DEEPWIKI_TOOLS,
];

export const TOOLS_ENV = "MAINA_MCP_TOOLS";
const TOOLS_FLAG = "--tools";
const DEFAULT_TOKEN = "default";

export type AllowList = Readonly<{
	tools: readonly ToolName[];
	/** Names in the spec that are not tools, as given. */
	unknown: readonly string[];
	source: "flag" | "env" | "default";
}>;

const isToolName = (name: string): name is ToolName =>
	(ALL_TOOLS as readonly string[]).includes(name);

/** Known names of `names` in catalog order, without duplicates. */
export function knownTools(names: readonly string[]): ToolName[] {
	const wanted = new Set(names);
	return ALL_TOOLS.filter((t) => wanted.has(t));
}

function parseSpec(spec: string): Pick<AllowList, "tools" | "unknown"> {
	const names = spec
		.split(",")
		.map((n) => n.trim())
		.filter((n) => n.length > 0);
	const expanded = names.flatMap((n) =>
		n === DEFAULT_TOKEN ? [...DEFAULT_TOOLS] : [n],
	);
	const unknown = [...new Set(expanded.filter((n) => !isToolName(n)))];
	return { tools: knownTools(expanded), unknown };
}

/**
 * The allow-list from the flag's value, else the env var's, else the
 * default set. A blank value counts as absent.
 */
export function resolveAllowList(
	input: Readonly<{ flag?: string; env?: string }>,
): AllowList {
	if (input.flag?.trim()) return { ...parseSpec(input.flag), source: "flag" };
	if (input.env?.trim()) return { ...parseSpec(input.env), source: "env" };
	return { tools: DEFAULT_TOOLS, unknown: [], source: "default" };
}

/** The value of `--tools <list>` or `--tools=<list>` in `argv`, if any. */
export function readToolsFlag(argv: readonly string[]): string | undefined {
	for (const [i, arg] of argv.entries()) {
		if (arg.startsWith(`${TOOLS_FLAG}=`)) {
			return arg.slice(TOOLS_FLAG.length + 1);
		}
		if (arg === TOOLS_FLAG) {
			const value = argv[i + 1];
			return value === undefined || value.startsWith("--") ? undefined : value;
		}
	}
	return undefined;
}
