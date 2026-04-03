import { getApiKey } from "../config/index";

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
	const apiKey = getApiKey();
	if (!apiKey) return null;

	try {
		const { buildSystemPrompt } = await import("../prompts/engine");
		const { generate } = await import("./index");

		const builtPrompt = await buildSystemPrompt("commit", mainaDir, {
			diff,
			files: stagedFiles.join(", "),
		});

		const result = await generate({
			task: "commit",
			systemPrompt: builtPrompt.prompt,
			userPrompt: `Generate a conventional commit message for this diff:\n\n${diff}\n\nFiles: ${stagedFiles.join(", ")}`,
			files: stagedFiles,
			mainaDir,
		});

		if (result.text && !result.text.includes("API key")) {
			// Clean up: extract first line as commit message
			const firstLine = result.text.trim().split("\n")[0] ?? "";
			return firstLine.replace(/^["'`]|["'`]$/g, "").trim() || null;
		}
	} catch {
		// AI failure returns null -- fall back to manual
	}

	return null;
}
