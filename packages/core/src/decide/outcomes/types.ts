/**
 * Outcomes (FR-DEC-4): what happened after a logged decision. An outcome is
 * linked to one decision log entry and is itself append-only. It carries
 * labels and ids (a commit sha, a CI run id), never code, diff text or paths.
 */

import type { ClockPort } from "../../ports/clock";
import type { DbPort } from "../../ports/db";
import type { DecisionType } from "../types";

export const OUTCOMES = [
	/** The user overrode the decision at a gate prompt. */
	"override",
	/** The user dismissed what the decision flagged. */
	"dismissed",
	/** The user accepted what the decision produced. */
	"accepted",
	/** The user rejected what the decision produced. */
	"rejected",
	/** The commit the decision was made for was reverted. */
	"reverted",
	/** A follow-up fix touched the same hunk soon after. */
	"hotfixed",
	/** Tests failed on a commit the decision allowed. */
	"test_failed_after_allow",
] as const;

export type Outcome = (typeof OUTCOMES)[number];

/** What to link: the outcome, who observed it and the evidence id. */
export type OutcomeInput = Readonly<{
	kind: Outcome;
	/** The observer, as a lower-case label (`gate`, `verify`, `git`, ...). */
	source: string;
	/** The evidence: a commit sha, a run id. Part of the outcome's identity. */
	ref?: string;
}>;

export type OutcomeRecord = Readonly<{
	/** Derived from the decision, the outcome and the ref: stable across runs. */
	id: string;
	decisionId: string;
	outcome: Outcome;
	source: string;
	ref?: string;
	/** When the outcome was first linked, in epoch milliseconds. */
	ts: number;
}>;

/** One decision linked to a commit, with what the log says about it. */
export type CommitDecision = Readonly<{
	decisionId: string;
	type: DecisionType;
	finalAction: string;
}>;

export type OutcomeError =
	| Readonly<{ kind: "invalid_outcome"; message: string }>
	| Readonly<{ kind: "unknown_decision"; decisionId: string }>
	| Readonly<{ kind: "db"; message: string }>
	| Readonly<{ kind: "corrupt_row"; id: string; message: string }>
	| Readonly<{ kind: "git"; message: string }>;

export type OutcomePorts = Readonly<{ db: DbPort; clock: ClockPort }>;
