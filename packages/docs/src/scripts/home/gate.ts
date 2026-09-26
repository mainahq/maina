/**
 * Try-your-own lookup (#360). The browser cannot run the gate's bash
 * grammar, so the build runs the real engine over the labelled corpus
 * (`scripts/landing-proofs.ts`) and the page looks a command up in that
 * table. A command the build did not evaluate gets no verdict.
 */

import type { CorpusRow } from "../../data/landing-proofs";

export type { CorpusRow };

/** Trimmed, with every run of whitespace as one space. */
export const normalizeCommand = (command: string): string =>
	command.trim().replace(/\s+/g, " ");

/**
 * The lookup table, or null when it could not be loaded (an HTTP error, a
 * network error or a body that is not a list). A failed load must not read
 * as "not in the corpus".
 */
export async function fetchCorpus(
	fetchFn: (url: string) => Promise<Response>,
	url: string,
): Promise<readonly CorpusRow[] | null> {
	try {
		const res = await fetchFn(url);
		if (!res.ok) return null;
		const body: unknown = await res.json();
		return Array.isArray(body) ? (body as readonly CorpusRow[]) : null;
	} catch {
		return null;
	}
}

export function lookupCommand(
	rows: readonly CorpusRow[],
	command: string,
): CorpusRow | null {
	const key = normalizeCommand(command);
	if (key === "") return null;
	return rows.find((row) => normalizeCommand(row.c) === key) ?? null;
}
