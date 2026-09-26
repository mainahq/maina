/**
 * The escape and bypass suite against a real `srt` (v1 task 4B.9,
 * FR-SBX-5, spec §9.6).
 *
 * For every case in `cases.ts`:
 *   - unsandboxed, the attack must ESCAPE — otherwise the case is toothless
 *     and proves nothing (Step 2).
 *   - sandboxed, the attack must be BLOCKED (Step 3).
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
import { runCase } from "../runner";

const CASE_MS = 30_000;

// Fail loudly when the sandbox is required but unavailable (the release job).
test.if(REQUIRE_SANDBOX && SKIP_REASON !== undefined)(
	"the sandbox runtime is installed (MAINA_REQUIRE_SANDBOX=1)",
	() => {
		throw new Error(`sandbox runtime unavailable: ${SKIP_REASON}`);
	},
);

describe.skipIf(SKIP_REASON !== undefined)(
	integrationTitle("escape and bypass suite (integration)"),
	() => {
		for (const esc of ESCAPE_CASES) {
			test(
				`${esc.category} · ${esc.id}: escapes unprotected, blocked sandboxed`,
				async () => {
					const unprotected = await runCase(esc, "unsandboxed");
					// The case has teeth: it really does get out with no sandbox.
					expect(unprotected.escaped).toBe(true);

					const sandboxed = await runCase(esc, "sandboxed");
					// And the sandbox holds it.
					expect(sandboxed.escaped).toBe(false);
				},
				CASE_MS,
			);
		}
	},
);
