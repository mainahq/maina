/**
 * Satisfaction (FR-FAC-4): the share of holdout scenario runs judged to
 * satisfy the user. Scenarios run several times each, so a flaky pass
 * lowers the score instead of hiding behind one lucky run. Pure.
 */

export type ScenarioRun = Readonly<{
	scenario: string;
	/** 1-based attempt number. */
	run: number;
	satisfied: boolean;
	note?: string;
}>;

export type ScenarioSatisfaction = Readonly<{
	scenario: string;
	runs: number;
	satisfiedRuns: number;
	score: number;
}>;

export type Satisfaction = Readonly<{
	runs: number;
	satisfiedRuns: number;
	/** `satisfiedRuns / runs`, 4 decimals; 0 when nothing ran. */
	score: number;
	/** Per scenario, in first-seen order. */
	scenarios: readonly ScenarioSatisfaction[];
}>;

const ratio = (part: number, whole: number): number =>
	whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 10_000;

export function computeSatisfaction(
	runs: readonly ScenarioRun[],
): Satisfaction {
	const perScenario = new Map<string, { runs: number; satisfied: number }>();
	for (const run of runs) {
		const tally = perScenario.get(run.scenario) ?? { runs: 0, satisfied: 0 };
		perScenario.set(run.scenario, {
			runs: tally.runs + 1,
			satisfied: tally.satisfied + (run.satisfied ? 1 : 0),
		});
	}
	const satisfiedRuns = runs.filter((run) => run.satisfied).length;
	return {
		runs: runs.length,
		satisfiedRuns,
		score: ratio(satisfiedRuns, runs.length),
		scenarios: [...perScenario].map(([scenario, tally]) => ({
			scenario,
			runs: tally.runs,
			satisfiedRuns: tally.satisfied,
			score: ratio(tally.satisfied, tally.runs),
		})),
	};
}
