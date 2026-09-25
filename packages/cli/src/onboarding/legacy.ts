/**
 * Retired agent files, written only with `maina setup --legacy-agents`.
 *
 * 1.x `maina init` wrote a file for every agent it knew about. Most of them
 * are now covered by `AGENTS.md` or by the host's own MCP settings, so they
 * are off by default. Markdown files use the managed region, JSON files a
 * managed key, and YAML files are only ever created, never edited.
 */

import type { RenderContext, TargetSpec } from "./plan";

const WORKFLOW =
	"brainstorm -> ticket -> plan -> design -> spec -> implement -> verify -> review -> fix -> commit -> review -> pr";

function rulesBody(title: string, c: RenderContext): string {
	return `# ${title}

This repo uses [Maina](https://mainahq.com) for verification-first development.
Read \`.maina/constitution.md\` for the full project DNA.

## Detected Stack
- Languages: ${c.stack.languages.join(", ") || "unknown"}
- Package manager: ${c.stack.packageManager}

## Workflow
\`${WORKFLOW}\`

## Constitution Quick Reference
${c.quickRef}

## Commands
- \`maina verify\` — run the full verification pipeline
- \`maina commit\` — verify + commit
- \`maina review\` — two-stage code review
- \`maina context\` — focused codebase context
`;
}

function markdown(path: string, title: string): TargetSpec {
	return { format: "markdown", path, render: (c) => rulesBody(title, c) };
}

function mcpKey(path: string, keyPath: readonly string[]): TargetSpec {
	return { format: "json-key", path, keyPath, render: (c) => c.mcpEntry };
}

const CONTINUE_CONFIG = `# Continue.dev configuration — written by maina setup --legacy-agents
# See https://docs.continue.dev/reference/config

customInstructions: |
  This repo uses Maina for verification-first development.
  Read .maina/constitution.md for project DNA.
  Workflow: ${WORKFLOW}
  Always run maina verify before committing.
`;

const AIDER_CONFIG = `# Maina conventions — written by maina setup --legacy-agents
read: [CONVENTIONS.md, .maina/constitution.md]
auto-commits: false
`;

export const LEGACY_TARGETS: readonly TargetSpec[] = [
	markdown("GEMINI.md", "GEMINI.md"),
	markdown(".cursorrules", "Cursor Rules"),
	markdown(".windsurfrules", "Windsurf Rules"),
	markdown(".clinerules", "Cline Rules"),
	markdown(".roo/rules/maina.md", "Maina (Roo Code)"),
	markdown("CONVENTIONS.md", "Conventions"),
	mcpKey(".roo/mcp.json", ["mcpServers", "maina"]),
	mcpKey(".amazonq/mcp.json", ["mcpServers", "maina"]),
	mcpKey(".continue/mcpServers/maina.json", ["maina"]),
	{
		format: "whole",
		path: ".continue/config.yaml",
		render: () => CONTINUE_CONFIG,
	},
	{ format: "whole", path: ".aider.conf.yml", render: () => AIDER_CONFIG },
];
