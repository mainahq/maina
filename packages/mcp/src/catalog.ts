/**
 * The agent-facing tool catalog (#465).
 *
 * Agent files (`maina setup`), skills and docs tell hosts which MCP tools
 * to call. Their tool lists are rendered from here, never hand-typed: the
 * names come from the allow-list's catalog and the guidance is keyed by
 * `ToolName`, so adding or renaming a tool fails to compile until it has a
 * line. Dependency-free, so the CLI can import it (`@mainahq/mcp/catalog`)
 * without loading the server.
 */

import type { ToolName } from "./allowlist";

export {
	ALL_TOOLS,
	DEEPWIKI_TOOLS,
	DEFAULT_TOOLS,
	type ToolName,
} from "./allowlist";

/** One line of guidance per tool: when an agent should call it. */
export const TOOL_USAGE: Readonly<Record<ToolName, string>> = {
	verify:
		"Run the verification pipeline on your changes before asking for review; fix findings on changed lines.",
	decide:
		"Ask the repo's policy typed questions (e.g. `finding.real`, `diff.needs_review`) instead of guessing.",
	impact:
		"Before changing files or symbols, see what they can affect: callers, dependent files, covering tests.",
	context:
		"Get the source you need for files or a query, within a token budget, before reading whole files.",
	review_triage:
		"Two-stage review of your diff (spec compliance, then code quality), triaged into blocking, advisory and info.",
	spec_check:
		"Check a feature's spec.md, plan.md and tasks.md agree before implementing it.",
	receipt:
		"Verify maina receipt JSON files against the v1 schema and their canonical hash.",
	status:
		"Check the maina version, the enabled tools, and whether the code graph, wiki and policy are ready.",
	ask_question:
		"Ask the maina wiki a question about the codebase; answers cite source articles.",
	read_wiki_structure:
		"List the maina wiki's articles with their paths, types and titles.",
	read_wiki_contents: "Read one maina wiki article by its path.",
};

/** 1.x tool names that no server registers any more. */
export const RETIRED_TOOLS = [
	"getContext",
	"getConventions",
	"reviewCode",
	"checkSlop",
	"explainModule",
	"suggestTests",
	"analyzeFeature",
	"wikiQuery",
	"wikiStatus",
	"reviewDesign",
] as const;

export type ToolListFormat = "list" | "table";

/** The markdown tool list for `tools`, one entry per tool, in order. */
export function renderToolList(
	tools: readonly ToolName[],
	format: ToolListFormat,
): string {
	if (format === "list") {
		return tools.map((t) => `- \`${t}\` — ${TOOL_USAGE[t]}`).join("\n");
	}
	return [
		"| Tool | When to use |",
		"|------|-------------|",
		...tools.map((t) => `| \`${t}\` | ${TOOL_USAGE[t]} |`),
	].join("\n");
}

const RETIRED_PATTERN = new RegExp(`\\b(${RETIRED_TOOLS.join("|")})\\b`, "g");

/** The retired tool names `text` mentions, each once, in first-seen order. */
export function findRetiredTools(text: string): string[] {
	return [
		...new Set([...text.matchAll(RETIRED_PATTERN)].map((m) => m[1])),
	].filter((n): n is string => n !== undefined);
}
