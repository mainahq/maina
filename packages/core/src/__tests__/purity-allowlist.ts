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
> = {
	"ai/delegation.ts": { "process.env": 5 },
	"benchmark/runner.ts": { "process.env": 1 },
	"config/index.ts": { "process.cwd": 1, "process.env": 18 },
	"context/engine.ts": { "process.cwd": 1, "process.env": 1 },
	"context/retrieval.ts": { "process.cwd": 3 },
	"feedback/collector.ts": { "process.env": 1 },
	"git/index.ts": { "process.cwd": 1, "process.env": 1 },
	"mcp/clients.ts": { "process.env": 6 },
	"receipt/agent-id.ts": { "process.cwd": 1, "process.env": 1 },
	"receipt/build.ts": { "process.cwd": 1 },
	"receipt/canonical.ts": { throw: 2 },
	"setup/confirm.ts": {
		"process.cwd": 1,
		"process.env": 2,
		"process.stdout": 1,
	},
	"setup/resolve-ai.ts": { "process.env": 2 },
	"setup/skills-deploy.ts": { "process.cwd": 1 },
	"telemetry/cli-error-reporter.ts": { "process.env": 5 },
	"telemetry/posthog-client.ts": { "process.env": 3 },
	"telemetry/reporter.ts": { "process.env": 5 },
};
