import type { StackContext } from "./types";

const WORKFLOW =
	"brainstorm -> ticket -> plan -> design -> spec -> implement -> verify -> review -> fix -> commit -> review -> pr";

/**
 * Generate the managed content for `.windsurf/rules/maina.md`.
 */
export function generateWindsurfRules(
	ctx: StackContext,
	constitutionQuickRef: string,
): string {
	const pm = ctx.packageManager || "npm";
	const stack = [
		ctx.languages.join("/"),
		...(ctx.frameworks.length > 0 ? [ctx.frameworks.join("+")] : []),
		`pm=${pm}`,
	]
		.filter(Boolean)
		.join(" | ");

	return `---
trigger: always_on
---

# Maina

**Stack:** ${stack}

This repo uses [Maina](https://mainahq.com) for verification-first development.
Read \`.maina/constitution.md\` for the full project DNA.

## Workflow
\`${WORKFLOW}\`

## Constitution Quick Reference
${constitutionQuickRef}

## MCP Tools
- \`getContext\`, \`verify\`, \`checkSlop\`, \`reviewCode\`, \`suggestTests\`
- \`wikiQuery\` — search codebase knowledge

## Rules
- TDD always
- Conventional commits
- No \`console.log\` in production
- Diff-only: only report findings on changed lines
- \`Result<T, E>\` — never throw
${ctx.linters.length > 0 ? `- Lint: ${ctx.linters.join(", ")}\n` : ""}${ctx.testRunners.length > 0 ? `- Test: ${ctx.testRunners.join(", ")}\n` : ""}`;
}
