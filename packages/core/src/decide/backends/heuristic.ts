/**
 * The heuristic backend: the deterministic 1.x judgements, wrapped so they
 * answer through `decide`. It must reproduce the golden fixtures in
 * `__golden__/decisions` exactly (FR-DEC-6). How it derives distributions
 * and confidence is documented in `./distribution.ts`.
 *
 * `action.risk` and `diff.sensitive` have no heuristic; a request for them
 * is an `unsupported` error rather than a guess. `diff.needs_review` and
 * `finding.severity` are v1 rules for the verify triage (#329).
 */

import type { Result } from "../../db/index";
import type {
	Backend,
	BackendAnswer,
	BackendError,
	DecisionState,
	DecisionType,
	Question,
} from "../types";
import { unsupported } from "./distribution";
import { reviewCategory, reviewerKind, taskTier } from "./heuristics/choice";
import { findingReal } from "./heuristics/findings";
import { contextSelect, wikiRelevance } from "./heuristics/retrieval";
import { slop } from "./heuristics/slop";
import {
	specContradiction,
	specCoverage,
	specImplLeak,
	specOrphan,
	specQuality,
} from "./heuristics/spec";
import { diffNeedsReview, findingSeverity } from "./heuristics/triage";

type Heuristic = (
	state: DecisionState,
	questions: readonly Question[],
) => Result<readonly BackendAnswer[], BackendError>;

const HEURISTICS: Readonly<Record<DecisionType, Heuristic | undefined>> = {
	"action.risk": undefined,
	"diff.sensitive": undefined,
	"diff.needs_review": diffNeedsReview,
	"task.tier": taskTier,
	"finding.real": findingReal,
	"finding.severity": findingSeverity,
	"spec.coverage": specCoverage,
	"spec.orphan": specOrphan,
	"spec.contradiction": specContradiction,
	"spec.impl_leak": specImplLeak,
	"spec.quality": specQuality,
	"review.category": reviewCategory,
	"review.reviewer_kind": reviewerKind,
	slop,
	"wiki.relevance": wikiRelevance,
	"context.select": contextSelect,
};

export const heuristicBackend: Backend = {
	id: "heuristic",
	version: "1",
	answer: ({ type, state, questions }) => {
		const heuristic = HEURISTICS[type];
		return heuristic === undefined
			? unsupported(undefined, `no heuristic for ${type}`)
			: heuristic(state, questions);
	},
};
