/**
 * Test signal (FR-DEC-4): when tests fail on a commit, every decision that
 * allowed that commit through gets a `test_failed_after_allow` outcome.
 */

import type { Result } from "../../db/index";
import { decisionsForCommit, linkOutcome } from "./link";
import type { OutcomeError, OutcomePorts, OutcomeRecord } from "./types";

/** The final action of a decision that let the change through. */
const ALLOW_ACTION = "allow";

/**
 * Links `test_failed_after_allow` to the `allow` decisions made for `commit`
 * (a full sha), with `ref` (a CI run or test run id) as the evidence.
 * Returns only the outcomes this call created, so repeating a report is a
 * no-op.
 */
export function linkTestFailure(
	ports: OutcomePorts,
	commit: string,
	ref: string,
): Result<readonly OutcomeRecord[], OutcomeError> {
	const decisions = decisionsForCommit(ports, commit);
	if (!decisions.ok) return decisions;
	const created: OutcomeRecord[] = [];
	for (const d of decisions.value) {
		if (d.finalAction !== ALLOW_ACTION) continue;
		const linked = linkOutcome(ports, d.decisionId, {
			kind: "test_failed_after_allow",
			source: "test",
			ref,
		});
		if (!linked.ok) return linked;
		if (linked.value.created) created.push(linked.value.record);
	}
	return { ok: true, value: created };
}
