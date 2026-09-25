import type { StackContext } from "./types";

const WORKFLOW =
	"brainstorm -> ticket -> plan -> design -> spec -> implement -> verify -> review -> fix -> commit -> review -> pr";

/**
 * Generate the managed content for `.github/copilot-instructions.md`.
 */
export function generateCopilotInstructions(
	ctx: StackContext,
	constitutionQuickRef: string,
): string {
	const pm = ctx.packageManager || "npm";
	const parts: string[] = [];
	if (ctx.languages.length > 0)
		parts.push(`Languages: ${ctx.languages.join(", ")}`);
	if (ctx.frameworks.length > 0)
		parts.push(`Frameworks: ${ctx.frameworks.join(", ")}`);
	parts.push(`Package manager: ${pm}`);
	if (ctx.linters.length > 0) parts.push(`Lint: ${ctx.linters.join(", ")}`);
	if (ctx.testRunners.length > 0)
		parts.push(`Test: ${ctx.testRunners.join(", ")}`);

	return `# Copilot Instructions

You are working on a codebase verified by [Maina](https://mainahq.com), the
verification-first developer OS. Maina MCP tools are available — use them.

## Detected Stack
${parts.map((p) => `- ${p}`).join("\n")}

## Workflow
\`${WORKFLOW}\`

## Step-by-step
1. **Get context** — call \`getContext\` to understand codebase state
2. **Write tests first** — TDD always. Failing tests → implement → passing tests
3. **Verify your work** — call \`verify\` before requesting review
4. **Check for slop** — call \`checkSlop\` on changed files
5. **Review your code** — call \`reviewCode\` with your diff

## Constitution Quick Reference
${constitutionQuickRef}

## Conventions
- Conventional commits (feat, fix, refactor, test, docs, chore)
- No \`console.log\` in production code
- Diff-only: only fix issues on changed lines
- Use \`Result<T, E>\` — never throw

## Audit Issues
Issues labeled \`audit\` come from maina's daily verification. Fix the specific
findings listed — don't refactor unrelated code.
`;
}
