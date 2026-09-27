/**
 * The escape and bypass suite against a real `srt` (v1 task 4B.9,
 * FR-SBX-5, spec §9.6), once per supported ACP worker (#569).
 *
 * For every worker and every case in `cases.ts`, with that worker's gate
 * integration installed:
 *   - unsandboxed, the attack must ESCAPE — otherwise the case is toothless
 *     and proves nothing (Step 2).
 *   - sandboxed, the attack must be BLOCKED (Step 3).
 *
 * `MAINA_ESCAPE_WORKERS` (a comma-separated list, or `all`, the default)
 * picks the workers; the `escape-suite.yml` matrix runs one per job.
 *
 * The suite needs the pinned sandbox runtime. Without it these tests skip
 * and say why; the `escape-suite.yml` workflow sets `MAINA_REQUIRE_SANDBOX=1`,
 * which turns the skip into a loud failure so a missing sandbox can never
 * pass for a green release check.
 */

import { describe, expect, test } from "bun:test";
import {
	integrationTitle,
	REQUIRE_SANDBOX,
	SKIP_REASON,
} from "../../../packages/harness/src/sandbox/__tests__/sandbox-fixture";
import { ESCAPE_CASES } from "../cases";
import { runCase, suiteWorkers } from "../runner";

const CASE_MS = 30_000;

const workers = suiteWorkers(process.env.MAINA_ESCAPE_WORKERS);

test.if(!workers.ok)("MAINA_ESCAPE_WORKERS names supported workers", () => {
	if (!workers.ok) throw new Error(workers.error.message);
});

// Fail loudly when the sandbox is required but unavailable (the release job).
test.if(REQUIRE_SANDBOX && SKIP_REASON !== undefined)(
	"the sandbox runtime is installed (MAINA_REQUIRE_SANDBOX=1)",
	() => {
		throw new Error(`sandbox runtime unavailable: ${SKIP_REASON}`);
	},
);

for (const worker of workers.ok ? workers.value : []) {
	describe.skipIf(SKIP_REASON !== undefined)(
		integrationTitle(`escape and bypass suite · ${worker} (integration)`),
		() => {
			for (const esc of ESCAPE_CASES) {
				test(
					`${worker} · ${esc.category} · ${esc.id}: escapes unprotected, blocked sandboxed`,
					async () => {
						const unprotected = await runCase(esc, "unsandboxed", worker);
						// The case has teeth: it really does get out with no sandbox.
						expect(unprotected.escaped).toBe(true);

						const sandboxed = await runCase(esc, "sandboxed", worker);
						// And the sandbox holds it.
						expect(sandboxed.escaped).toBe(false);
					},
					CASE_MS,
				);
			}
		},
	);
}
