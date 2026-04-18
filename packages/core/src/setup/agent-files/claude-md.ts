import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Result } from "../../db/index";
import { mergeManaged, wrapManaged } from "./region";
import type { StackContext } from "./types";

const WORKFLOW =
	"brainstorm -> ticket -> plan -> design -> spec -> implement -> verify -> review -> fix -> commit -> review -> pr";

/**
 * Generate the managed portion of CLAUDE.md (inner content, before wrapping
 * in the maina-managed region). Tailored to the detected stack.
 */
export function generateClaudeMd(
	ctx: StackContext,
	constitutionQuickRef: string,
): string {
	const pm = ctx.packageManager || "npm";
	const summary: string[] = [];
	if (ctx.languages.length > 0) summary.push(ctx.languages.join("/"));
	if (ctx.frameworks.length > 0) summary.push(ctx.frameworks.join("+"));
	summary.push(`pm=${pm}`);
	if (ctx.linters.length > 0) summary.push(`lint=${ctx.linters.join(",")}`);
	if (ctx.testRunners.length > 0)
		summary.push(`test=${ctx.testRunners.join(",")}`);

	return `# Maina (Claude Code)

**Stack:** ${summary.join(" | ")}

This repo uses [Maina](https://mainahq.com) for verification-first development.
Read \`.maina/constitution.md\` for the full project DNA.

## Workflow
\`${WORKFLOW}\`

## Constitution Quick Reference
${constitutionQuickRef}

## MCP Tools (via .mcp.json)
- \`getContext\` — branch state + verification status
- \`verify\` — run the full verification pipeline
- \`checkSlop\` — detect AI slop on changed files
- \`reviewCode\` — two-stage review on your diff
- \`suggestTests\` — TDD test stubs
- \`getConventions\` — project conventions
- \`explainModule\` — understand a module
- \`wikiQuery\` — search codebase knowledge

## Rules
- TDD always — write tests first, watch them fail, implement
- Conventional commits (feat, fix, refactor, test, docs, chore)
- No \`console.log\` in production code
- Diff-only: only report findings on changed lines
- Use \`Result<T, E>\` — never throw
`;
}

/**
 * Write CLAUDE.md at repoRoot, preserving any existing user content outside
 * the maina-managed region. Atomic via write-temp + rename.
 */
export async function writeClaudeMd(
	cwd: string,
	managedContent: string,
): Promise<Result<{ path: string; action: "created" | "merged" }>> {
	const target = join(cwd, "CLAUDE.md");
	try {
		mkdirSync(dirname(target), { recursive: true });
		if (existsSync(target)) {
			const existing = readFileSync(target, "utf-8");
			const merged = mergeManaged(existing, managedContent);
			const tmp = `${target}.maina.tmp`;
			writeFileSync(tmp, merged, "utf-8");
			renameSync(tmp, target);
			return { ok: true, value: { path: target, action: "merged" } };
		}
		const wrapped = `${wrapManaged(managedContent)}\n`;
		const tmp = `${target}.maina.tmp`;
		writeFileSync(tmp, wrapped, "utf-8");
		renameSync(tmp, target);
		return { ok: true, value: { path: target, action: "created" } };
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
