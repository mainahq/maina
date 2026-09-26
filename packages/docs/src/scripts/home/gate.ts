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

export function lookupCommand(
	rows: readonly CorpusRow[],
	command: string,
): CorpusRow | null {
	const key = normalizeCommand(command);
	if (key === "") return null;
	return rows.find((row) => normalizeCommand(row.c) === key) ?? null;
}
