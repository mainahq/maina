import { tryAIGenerate } from "./try-generate";

/**
 * Generate a conventional commit message from a diff using AI.
 *
 * Returns null when no API key is available or on any failure,
 * allowing callers to fall back to manual message entry.
 */
export async function generateCommitMessage(
	diff: string,
	stagedFiles: string[],
	mainaDir: string,
): Promise<string | null> {
	const aiResult = await tryAIGenerate(
		"commit",
		mainaDir,
		{ diff, files: stagedFiles.join(", ") },
		`Generate a conventional commit message for this diff:\n\n${diff}\n\nFiles: ${stagedFiles.join(", ")}`,
	);

	if (aiResult.text && aiResult.fromAI) {
		// Clean up: extract first line as commit message
		const firstLine = aiResult.text.trim().split("\n")[0] ?? "";
		return firstLine.replace(/^["'`]|["'`]$/g, "").trim() || null;
	}

	return null;
}
