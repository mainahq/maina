/**
 * Blast radius of a change, from the code graph (v1 task 6.3, FR-VER-5).
 *
 * Changed lines are the right scope for most findings, but not for the
 * checks where a change breaks code it never touched: a new function
 * signature fails to type-check in its callers, and a changed function can
 * fail the tests of everything that calls it. The graph's `impact` query
 * answers what those are; this module turns its report into:
 *
 * - `callers`: the line spans of code that calls or references the change,
 *   where a type error is the change's doing;
 * - `dependents`: the files holding them (or importing a changed file),
 *   which the type checker must see;
 * - `tests`: the test files covering the change and its callers.
 *
 * Pure over a graph port; the store is read, never written.
 */

import type { Result } from "../db/index";
import { impact } from "../graph/query/impact";
import type { GraphReadPorts, ImpactReport } from "../graph/query/types";
import type { GraphStoreError } from "../graph/store/types";
import type { Finding } from "./diff-filter";
import { TYPECHECK_TOOLS } from "./typecheck";

export type CallerSpan = Readonly<{
	path: string;
	startLine: number;
	endLine: number;
}>;

export type BlastRadius = Readonly<{
	/** Code calling, referencing or extending the change, within range. */
	callers: readonly CallerSpan[];
	/** Other non-test files holding a caller or importing a changed file; sorted. */
	dependents: readonly string[];
	/** Test files covering the change or a caller in range; sorted. */
	tests: readonly string[];
}>;

/**
 * TypeScript errors a dependent gets on its import of a changed file (a
 * removed or renamed export), which sits outside any caller's span.
 */
const IMPORT_ERRORS: ReadonlySet<string> = new Set([
	"TS2305", // Module has no exported member
	"TS2307", // Cannot find module
	"TS2459", // Module declares it locally, but it is not exported
	"TS2460", // Module declares it locally, but it is exported as ...
	"TS2614", // Module has no exported member. Did you mean to use import ... from?
	"TS2724", // Module has no exported member. Did you mean ...?
]);

/** The radius an impact report describes. Pure. */
function blastRadiusOf(report: ImpactReport): BlastRadius {
	return {
		callers: report.callers.map((c) => ({
			path: c.path,
			startLine: c.startLine,
			endLine: c.endLine,
		})),
		dependents: [...report.dependents],
		tests: [...new Set(report.tests.map((t) => t.path))].sort(),
	};
}

/**
 * The blast radius of changing `files` (repo-relative): their callers up to
 * the impact query's default depth, the files those live in, and the tests
 * covering them. Files the graph does not know add nothing.
 */
export function computeBlastRadius(
	ports: GraphReadPorts,
	files: readonly string[],
): Result<BlastRadius, GraphStoreError> {
	const report = impact(ports, { files });
	if (!report.ok) return report;
	return { ok: true, value: blastRadiusOf(report.value) };
}

/**
 * Whether a type error off the changed lines is still the change's doing:
 * it sits inside a caller, or on a dependent's import of a changed file.
 * Every other tool stays diff-only (a failing affected test is always in
 * scope, radius or not; the diff filter shows it).
 */
export function inBlastRadius(finding: Finding, radius: BlastRadius): boolean {
	if (!TYPECHECK_TOOLS.has(finding.tool)) return false;
	const inCaller = radius.callers.some(
		(c) =>
			c.path === finding.file &&
			finding.line >= c.startLine &&
			finding.line <= c.endLine,
	);
	if (inCaller) return true;
	return (
		finding.ruleId !== undefined &&
		IMPORT_ERRORS.has(finding.ruleId) &&
		radius.dependents.includes(finding.file)
	);
}

/**
 * Files the type checker runs on: the changed ones plus their dependents,
 * so a caller in another workspace project is checked too.
 */
export function typecheckScope(
	files: readonly string[],
	radius: BlastRadius | undefined,
): string[] {
	return [...new Set([...files, ...(radius?.dependents ?? [])])];
}
