import { addEntry } from "../context/episodic";

/** Maximum character length for compressed review (approx 500 tokens) */
const MAX_COMPRESSED_CHARS = 2000;

/**
 * Compress an accepted AI review into a short episodic entry
 * suitable as a few-shot example for future context.
 *
 * Target: under 500 tokens per compressed entry.
 */
export function compressReview(review: {
	diff: string;
	aiOutput: string;
	task: string;
	accepted: boolean;
}): string | null {
	if (!review.accepted) return null;

	// Extract file names from diff headers (+++ b/path)
	const fileRegex = /^\+\+\+ b\/(.+)$/gm;
	const files: string[] = [];
	let match: RegExpExecArray | null = null;
	match = fileRegex.exec(review.diff);
	while (match !== null) {
		files.push(match[1] as string);
		match = fileRegex.exec(review.diff);
	}
	const uniqueFiles = [...new Set(files)];

	// Extract key findings from AI output (lines with issue/fix/error/warning keywords)
	const findingKeywords = /\b(issue|fix|error|warning|bug|problem|critical)\b/i;
	const aiLines = review.aiOutput.split("\n");
	const findings = aiLines.filter((line) => findingKeywords.test(line));

	// Extract verdict/summary (look for lines starting with "Overall", "Summary", "Verdict", or last non-empty line)
	const verdictRegex = /^(overall|summary|verdict|conclusion)\b/i;
	let verdict = aiLines.find((line) => verdictRegex.test(line.trim()));
	if (!verdict) {
		// Fall back to last non-empty, non-finding line
		const nonEmpty = aiLines.filter(
			(line) => line.trim().length > 0 && !findingKeywords.test(line),
		);
		verdict = nonEmpty[nonEmpty.length - 1] ?? "";
	}

	// Build the compressed entry
	const parts: string[] = [];

	parts.push(`[${review.task}] Accepted review`);

	if (uniqueFiles.length > 0) {
		parts.push(`Files: ${uniqueFiles.join(", ")}`);
	}

	if (findings.length > 0) {
		// Limit findings to keep under budget
		const limitedFindings = findings.slice(0, 10);
		parts.push("Findings:");
		for (const f of limitedFindings) {
			parts.push(`  - ${f.trim()}`);
		}
	}

	if (verdict) {
		parts.push(`Verdict: ${verdict.trim()}`);
	}

	let compressed = parts.join("\n");

	// Trim to MAX_COMPRESSED_CHARS
	if (compressed.length > MAX_COMPRESSED_CHARS) {
		compressed = `${compressed.slice(0, MAX_COMPRESSED_CHARS - 3)}...`;
	}

	return compressed;
}

/**
 * Store a compressed review as an episodic entry.
 */
export function storeCompressedReview(
	mainaDir: string,
	compressed: string,
	task: string,
): void {
	addEntry(mainaDir, {
		content: compressed,
		summary: `Accepted ${task} review`,
		type: "review",
	});
}
