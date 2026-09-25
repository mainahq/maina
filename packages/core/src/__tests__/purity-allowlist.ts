import type { PurityRule } from "./purity-scanner";

/**
 * Purity ratchet allow-list (issue #289): every `packages/core/src` file that
 * violated the functional-core rules when the ratchet landed, with the exact
 * number of violations per rule (paths relative to `packages/core/src`).
 *
 * This list may only shrink. `purity.test.ts` fails when a file not listed
 * here offends, when a listed file's count for a rule goes up, and when a
 * count goes down without this entry being lowered (or removed once the file
 * is clean). Never add an entry to make a new violation pass; inject a
 * `CorePorts` member or return a `Result` instead.
 */
export const PURITY_ALLOWLIST: Readonly<
	Record<string, Readonly<Partial<Record<PurityRule, number>>>>
> = {};
