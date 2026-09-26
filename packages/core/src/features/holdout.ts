/**
 * Holdout scenarios (FR-FAC-4): end-to-end user stories kept in
 * `.maina/holdout/<feature>/*.md`, a directory every worker's sandbox denies
 * (FR-SBX-2), so the implementer can't write to the test. Maina runs them
 * after implementation, several times each, and reports a satisfaction
 * score alongside pass/fail.
 *
 * Running a scenario (driving the software, judging the outcome) is the
 * injected `runScenario`; this module reads the scenarios, schedules the
 * runs and scores them.
 */

import { join } from "node:path";
import type { Result } from "../db/index";
import type { FsPort } from "../ports/fs";
import { isFeatureName } from "./acceptance";
import {
	computeSatisfaction,
	type Satisfaction,
	type ScenarioRun,
} from "./satisfaction";

/** The holdout root: what `maina run` hides from every worker. */
export function holdoutDir(root: string): string {
	return join(root, ".maina", "holdout");
}

/** One feature's scenarios. `feature` must be a feature folder name. */
export function holdoutFeatureDir(root: string, feature: string): string {
	return join(holdoutDir(root), feature);
}

export type Scenario = Readonly<{
	/** The file name without `.md`. */
	id: string;
	path: string;
	text: string;
}>;

export type ScenarioJudgement = Readonly<{ satisfied: boolean; note?: string }>;

export type HoldoutDeps = Readonly<{
	fs: FsPort;
	/** Runs `scenario` once (attempt `run`, 1-based) and judges it. */
	runScenario: (
		scenario: Scenario,
		run: number,
	) => Promise<Result<ScenarioJudgement, Readonly<{ message: string }>>>;
}>;

export type HoldoutOptions = Readonly<{
	/** Runs per scenario, 1 to 20. Default 3. */
	runs?: number;
	/** The satisfaction (0..1) at which the holdout passes. Default 1. */
	minSatisfaction?: number;
}>;

export type HoldoutResult = Readonly<{
	passed: boolean;
	satisfaction: number;
	detail: Satisfaction;
	runs: readonly ScenarioRun[];
}>;

export type HoldoutError =
	| Readonly<{ kind: "invalid_feature"; feature: string }>
	| Readonly<{ kind: "invalid_options"; message: string }>
	| Readonly<{ kind: "no_holdout"; path: string }>
	| Readonly<{ kind: "no_scenarios"; path: string }>
	| Readonly<{ kind: "io"; path: string; message: string }>;

const DEFAULT_RUNS = 3;
const MAX_RUNS = 20;

function checkOptions(
	options: HoldoutOptions,
): Result<Required<HoldoutOptions>, HoldoutError> {
	const runs = options.runs ?? DEFAULT_RUNS;
	const minSatisfaction = options.minSatisfaction ?? 1;
	if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) {
		return {
			ok: false,
			error: {
				kind: "invalid_options",
				message: `runs must be an integer from 1 to ${MAX_RUNS}`,
			},
		};
	}
	if (!(minSatisfaction >= 0 && minSatisfaction <= 1)) {
		return {
			ok: false,
			error: {
				kind: "invalid_options",
				message: "minSatisfaction must be between 0 and 1",
			},
		};
	}
	return { ok: true, value: { runs, minSatisfaction } };
}

async function readScenarios(
	fs: FsPort,
	dir: string,
): Promise<Result<readonly Scenario[], HoldoutError>> {
	const names = await fs.readDir(dir);
	if (!names.ok) {
		return names.error.kind === "not_found"
			? { ok: false, error: { kind: "no_holdout", path: dir } }
			: {
					ok: false,
					error: { kind: "io", path: dir, message: names.error.message },
				};
	}
	const scenarios: Scenario[] = [];
	for (const name of names.value.filter((n) => n.endsWith(".md"))) {
		const path = join(dir, name);
		const read = await fs.readFile(path);
		if (!read.ok) {
			const message =
				read.error.kind === "io" ? read.error.message : "scenario vanished";
			return { ok: false, error: { kind: "io", path, message } };
		}
		scenarios.push({
			id: name.slice(0, -".md".length),
			path,
			text: read.value,
		});
	}
	return scenarios.length === 0
		? { ok: false, error: { kind: "no_scenarios", path: dir } }
		: { ok: true, value: scenarios };
}

/**
 * Runs every scenario of `feature` `runs` times, in order, and scores
 * satisfaction over all runs. A run whose runner fails counts as not
 * satisfied: a broken harness never passes a holdout.
 */
export async function runHoldout(
	root: string,
	feature: string,
	deps: HoldoutDeps,
	options: HoldoutOptions = {},
): Promise<Result<HoldoutResult, HoldoutError>> {
	if (!isFeatureName(feature)) {
		return { ok: false, error: { kind: "invalid_feature", feature } };
	}
	const checked = checkOptions(options);
	if (!checked.ok) return checked;
	const scenarios = await readScenarios(
		deps.fs,
		holdoutFeatureDir(root, feature),
	);
	if (!scenarios.ok) return scenarios;

	const runs: ScenarioRun[] = [];
	for (const scenario of scenarios.value) {
		for (let run = 1; run <= checked.value.runs; run++) {
			const judged = await deps.runScenario(scenario, run);
			runs.push(
				judged.ok
					? {
							scenario: scenario.id,
							run,
							satisfied: judged.value.satisfied,
							...(judged.value.note === undefined
								? {}
								: { note: judged.value.note }),
						}
					: {
							scenario: scenario.id,
							run,
							satisfied: false,
							note: `runner failed: ${judged.error.message}`,
						},
			);
		}
	}
	const detail = computeSatisfaction(runs);
	return {
		ok: true,
		value: {
			passed: detail.score >= checked.value.minSatisfaction,
			satisfaction: detail.score,
			detail,
			runs,
		},
	};
}
