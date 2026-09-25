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
 * The `Bun.spawn` rule landed later (#420) with the entries below as its
 * baseline: each is a direct spawn still waiting to move onto
 * `CorePorts.process` (a `ProcessPort`). `process/index.ts` is the system
 * `ProcessPort` adapter itself, the one sanctioned spawn site; it reads the
 * parent environment only to hand it (minus repo-local `GIT_*` variables)
 * to the child.
 */
export const PURITY_ALLOWLIST: Readonly<
	Record<string, Readonly<Partial<Record<PurityRule, number>>>>
> = {
	"process/index.ts": { "Bun.spawn": 1, "process.env": 1 },
	"benchmark/runner.ts": { "Bun.spawn": 1 },
	"context/retrieval.ts": { "Bun.spawn": 5 },
	"features/traceability.ts": { "Bun.spawn": 1 },
	"feedback/external-reviews.ts": { "Bun.spawn": 1 },
	"hooks/runner.ts": { "Bun.spawn": 1 },
	"ticket/index.ts": { "Bun.spawn": 1 },
	"verify/detect.ts": { "Bun.spawn": 1 },
	"verify/proof.ts": { "Bun.spawn": 1 },
	"verify/syntax-guard.ts": { "Bun.spawn": 2 },
	"verify/tools/wiki-lint.ts": { "Bun.spawn": 1 },
	"verify/visual.ts": { "Bun.spawn": 1 },
};
