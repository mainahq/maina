import { tryAIGenerate } from "./try-generate";

/**
 * Generate a structured PR summary from a diff and commit list.
 *
 * Returns a markdown body with ## Summary, ## What Changed, and ## Review sections.
 * Falls back to commit list if AI is unavailable.
 */
export async function generatePrSummary(
	diff: string,
	commits: Array<{ hash: string; message: string }>,
	reviewSummary: string,
	mainaDir: string,
): Promise<string> {
	const commitList = commits
		.map((c) => `- ${c.message} (${c.hash.slice(0, 7)})`)
		.join("\n");

	const aiResult = await tryAIGenerate(
		"pr",
		mainaDir,
		{ diff, commits: commitList },
		`Write a concise PR description for the following changes.

## Commits
${commitList}

## Diff (truncated)
${diff.slice(0, 8000)}

Instructions:
- Start with a 1-2 sentence summary of WHAT this PR does and WHY
- Then a "## What Changed" section with 3-6 bullet points grouped by theme (not one per commit)
- Focus on user-visible impact, not implementation details
- Do not repeat commit hashes or the full commit log
- Do not include a review section (that's added separately)
- Use markdown formatting`,
	);

	if (aiResult.text && aiResult.fromAI) {
		return `${aiResult.text.trim()}

## Review

${reviewSummary}`;
	}

	// Fallback: structured commit list
	return `## Summary

${commits.length} commit(s) in this PR.

## What Changed

${commitList}

## Review

${reviewSummary}`;
}
