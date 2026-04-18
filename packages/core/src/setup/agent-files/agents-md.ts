import type { StackContext } from "./types";

const WORKFLOW =
	"brainstorm -> ticket -> plan -> design -> spec -> implement -> verify -> review -> fix -> commit -> review -> pr";

function stackLine(ctx: StackContext): string {
	const parts: string[] = [];
	if (ctx.languages.length > 0)
		parts.push(`**Languages:** ${ctx.languages.join(", ")}`);
	if (ctx.frameworks.length > 0)
		parts.push(`**Frameworks:** ${ctx.frameworks.join(", ")}`);
	if (ctx.packageManager)
		parts.push(`**Package manager:** ${ctx.packageManager}`);
	if (ctx.buildTool) parts.push(`**Build:** ${ctx.buildTool}`);
	if (ctx.linters.length > 0) parts.push(`**Lint:** ${ctx.linters.join(", ")}`);
	if (ctx.testRunners.length > 0)
		parts.push(`**Test:** ${ctx.testRunners.join(", ")}`);
	if (ctx.cicd.length > 0) parts.push(`**CI:** ${ctx.cicd.join(", ")}`);
	return parts.join(" | ");
}

/**
 * Generate AGENTS.md managed content — universal agent instructions
 * referencing the detected stack and the maina workflow.
 */
export function generateAgentsMd(
	ctx: StackContext,
	constitutionQuickRef: string,
): string {
	const pm = ctx.packageManager || "npm";
	const runCmd = pm === "bun" ? "bun" : "npm run";
	const installCmd = pm === "bun" ? "bun install" : "npm install";

	return `# AGENTS.md

This repo uses [Maina](https://mainahq.com) for verification-first development.

## Detected Stack
${stackLine(ctx)}

## Workflow
\`${WORKFLOW}\`

## Quick Start
\`\`\`bash
${installCmd}
maina doctor    # check tool health
maina verify    # run the verification pipeline
maina commit    # verify + commit
\`\`\`

## Constitution Quick Reference
${constitutionQuickRef}

## Commands
- \`maina verify\` — full verification pipeline
- \`maina commit\` — verify + commit staged changes
- \`maina review\` — two-stage code review
- \`maina context\` — focused codebase context
- \`${runCmd} test\` — run tests
${ctx.linters.length > 0 ? `- \`${runCmd} check\` — lint (${ctx.linters.join(", ")})\n` : ""}
See \`.maina/constitution.md\` for the full project DNA.`;
}
