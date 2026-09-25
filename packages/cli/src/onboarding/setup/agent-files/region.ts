/**
 * Delimited maina-managed region utilities.
 *
 * Agent files wrap Maina-authored content in a delimited region so re-runs
 * of the setup wizard only update that region — user-authored content above
 * and below is preserved verbatim.
 */

export const MAINA_REGION_START = "<!-- maina-managed:start -->";
export const MAINA_REGION_END = "<!-- maina-managed:end -->";

/**
 * Wrap raw managed content with the maina-managed delimiters.
 * The returned string is a drop-in block that can be appended or inserted
 * into any markdown file.
 */
export function wrapManaged(content: string): string {
	const body = content.endsWith("\n") ? content.slice(0, -1) : content;
	return `${MAINA_REGION_START}\n${body}\n${MAINA_REGION_END}`;
}

/**
 * Merge maina-managed content into an existing file.
 * - If the file already contains a maina-managed region, replace it in place.
 * - Otherwise, append the wrapped region to the end with a blank line separator.
 * - If the existing content is empty/whitespace, return the wrapped region alone.
 */
export function mergeManaged(existing: string, managed: string): string {
	const wrapped = wrapManaged(managed);
	const trimmed = existing.trim();

	if (trimmed.length === 0) {
		return `${wrapped}\n`;
	}

	const startIdx = existing.indexOf(MAINA_REGION_START);
	const endIdx = existing.indexOf(MAINA_REGION_END);

	if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
		const before = existing.slice(0, startIdx);
		const after = existing.slice(endIdx + MAINA_REGION_END.length);
		return `${before}${wrapped}${after}`;
	}

	// No existing region — append with blank line separator.
	const trailing = existing.endsWith("\n") ? "" : "\n";
	return `${existing}${trailing}\n${wrapped}\n`;
}

/**
 * Extract the content inside the maina-managed region (delimiters excluded).
 * Returns null if no region is present.
 */
export function extractManaged(content: string): string | null {
	const startIdx = content.indexOf(MAINA_REGION_START);
	const endIdx = content.indexOf(MAINA_REGION_END);
	if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
		return null;
	}
	const inner = content.slice(startIdx + MAINA_REGION_START.length, endIdx);
	// Trim one leading and one trailing newline introduced by wrapManaged.
	return inner.replace(/^\n/, "").replace(/\n$/, "");
}
