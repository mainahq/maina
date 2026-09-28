/**
 * The managed policy layer (#592, cloud plan Task 6.3, FR-POL-1/2/7).
 *
 * On a machine enrolled in Maina Cloud, the org's policy bundle (pulled and
 * verified by the runtime's Link client) becomes the `managed` layer:
 * defaults < managed < user < repo, and the managed layer is a floor, so a
 * user or repo layer may only tighten what it sets (`load.ts`).
 *
 * A bundle is `signed` by the org's pinned policy-bundle key, or `unsigned`
 * while the cloud's production signer is dark (cloud adr/0012). An unsigned
 * managed layer is accepted only to tighten: it carries no
 * `explicitly_allow`, so it can never loosen an irreversible class, and it
 * cannot raise a run budget.
 *
 * Budget directives (cloud Task 9.2) say an org or team budget for a period
 * was reached; `activeBudgetDirectives` keeps those whose period is still
 * the one the bundle was issued in. Pure: the runtime reads and verifies the
 * bundle, this module only interprets it.
 */

import type { Result } from "../db/index";
import { managedLayerErrors } from "./load";
import {
	type ManagedBudgetDirective,
	type ManagedSignature,
	type PolicyError,
	type PolicyLayer,
	parsePolicyLayer,
} from "./schema";

export type { ManagedBudgetDirective, ManagedSignature } from "./schema";

/** What the runtime hands over from a verified bundle. */
export type ManagedLayerInput = Readonly<{
	/** The bundle's policy body, not yet validated. */
	policy: unknown;
	version: number;
	/** The bundle's content ETag (`sha256:` of policy, budgets, exceptions). */
	etag: string;
	signature: ManagedSignature;
	keyId: string;
	issuedAt: string;
	budgetDirectives: readonly ManagedBudgetDirective[];
}>;

/** A validated managed layer, as `loadPolicy` takes it. */
export type ManagedLayer = Readonly<
	Omit<ManagedLayerInput, "policy"> & { value: PolicyLayer }
>;

/**
 * Validates a bundle's policy body as the managed layer. It must be a valid
 * policy layer that merges onto the defaults without error; an unsigned one
 * is held to tightening only.
 */
export function parseManagedLayer(
	input: ManagedLayerInput,
): Result<ManagedLayer, readonly PolicyError[]> {
	const parsed = parsePolicyLayer(input.policy, "managed");
	if (!parsed.ok) return parsed;
	const errors = managedLayerErrors(
		parsed.value,
		input.signature === "unsigned",
	);
	if (errors.length > 0) return { ok: false, error: errors };
	const { policy: _raw, ...meta } = input;
	return { ok: true, value: { ...meta, value: parsed.value } };
}

/** The UTC start of the `period` that contains `t`; weeks start on Monday. */
function periodStart(
	period: ManagedBudgetDirective["period"],
	t: Date,
): number {
	const y = t.getUTCFullYear();
	const m = t.getUTCMonth();
	const d = t.getUTCDate();
	switch (period) {
		case "day":
			return Date.UTC(y, m, d);
		case "week":
			return Date.UTC(y, m, d - ((t.getUTCDay() + 6) % 7));
		case "month":
			return Date.UTC(y, m, 1);
		default: {
			const unknown: never = period;
			return unknown;
		}
	}
}

/**
 * The directives still in force at `now`: a directive holds until its period
 * (UTC day, ISO week or month) rolls over from the one the bundle was issued
 * in, when the cloud's budget resets. A newer bundle replaces the list
 * anyway; this only stops an offline machine from being held forever. An
 * issue time that cannot be read keeps them all (fail closed).
 */
export function activeBudgetDirectives(
	directives: readonly ManagedBudgetDirective[],
	issuedAt: string,
	now: Date,
): readonly ManagedBudgetDirective[] {
	const issued = new Date(issuedAt);
	if (Number.isNaN(issued.getTime())) return directives;
	return directives.filter(
		(d) => periodStart(d.period, now) <= periodStart(d.period, issued),
	);
}
