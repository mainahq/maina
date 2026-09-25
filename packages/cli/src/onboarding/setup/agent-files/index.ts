/**
 * Agent instruction files — tailored per tool, managed-region safe.
 *
 * Each entry names a file and the generator for the Maina-authored body.
 * `planOnboarding` (../../plan.ts) wraps that body in a `<maina-managed>`
 * region, so later runs update only the region and user content above and
 * below is preserved verbatim.
 */

import { generateAgentsMd } from "./agents-md";
import { generateClaudeMd } from "./claude-md";
import { generateCopilotInstructions } from "./copilot-instructions";
import { generateCursorRules } from "./cursor-rules";
import type { StackContext } from "./types";
import { generateWindsurfRules } from "./windsurf-rules";

export type AgentKind = "agents" | "claude" | "cursor" | "copilot" | "windsurf";

export const ALL_AGENTS: readonly AgentKind[] = [
	"agents",
	"claude",
	"cursor",
	"copilot",
	"windsurf",
];

interface AgentFile {
	readonly kind: AgentKind;
	readonly path: string;
	readonly generate: (ctx: StackContext, quickRef: string) => string;
}

export const AGENT_FILES: readonly AgentFile[] = [
	{ kind: "agents", path: "AGENTS.md", generate: generateAgentsMd },
	{ kind: "claude", path: "CLAUDE.md", generate: generateClaudeMd },
	{
		kind: "cursor",
		path: ".cursor/rules/maina.mdc",
		generate: generateCursorRules,
	},
	{
		kind: "copilot",
		path: ".github/copilot-instructions.md",
		generate: generateCopilotInstructions,
	},
	{
		kind: "windsurf",
		path: ".windsurf/rules/maina.md",
		generate: generateWindsurfRules,
	},
];
