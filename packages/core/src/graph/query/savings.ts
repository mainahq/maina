/**
 * Token accounting for graph-built context: what reading the files in full
 * would cost (the naive read) and how much a smaller context saves on it.
 * Uses the same estimate as the context engine's budget.
 */

import { calculateTokens } from "../../context/budget";

/** Tokens to read each file in full, keyed by path so each counts once. */
export function naiveReadTokens(files: ReadonlyMap<string, string>): number {
	let total = 0;
	for (const content of files.values()) total += calculateTokens(content);
	return total;
}

/** Tokens saved by sending `used` instead of the naive read; never negative. */
export function tokenSavings(naive: number, used: number): number {
	return Math.max(0, naive - used);
}
