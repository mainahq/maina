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
 *
 * The `Bun.spawn` rule landed later (#420); #433 moved the last legacy
 * direct spawns onto `CorePorts.process` (a `ProcessPort`), so the only
 * entry left is `process/index.ts`: the system `ProcessPort` adapter
 * itself, the one sanctioned spawn site. It reads the parent environment
 * only to hand it (minus repo-local `GIT_*` variables) to the child.
 */
export const PURITY_ALLOWLIST: Readonly<
	Record<string, Readonly<Partial<Record<PurityRule, number>>>>
> = {
	"process/index.ts": { "Bun.spawn": 1, "process.env": 1 },
};
