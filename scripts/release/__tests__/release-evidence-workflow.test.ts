/**
 * The release-evidence workflow's e2e repetitions (mainahq/maina#652): the
 * nightly run and an on-demand dispatch with the default input must each
 * record enough real-config matrix runs for the e2e-matrix gate on their
 * own, so `release:gates --run latest` can pass on the latest evidence.
 *
 * The runs per repetition come from the workflow's e2e job matrix (OS ×
 * host × install path) times the environments each cell runs
 * (`ENV_MODES`), and the verdict from the gate evaluator itself, so a
 * smaller matrix or a higher threshold shows up here.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	ENV_MODES,
	HOSTS,
	INSTALL_PATHS,
} from "../../../ci/e2e/real-config/matrix";
import {
	evaluateGates,
	GATE_ITEMS,
	type GateContext,
	THRESHOLDS,
} from "../v1-gates";

type Workflow = Readonly<{
	on: Readonly<{
		schedule?: readonly unknown[];
		workflow_dispatch?: Readonly<{
			inputs?: Readonly<Record<string, Readonly<{ default?: unknown }>>>;
		}>;
	}>;
	env: Readonly<Record<string, string>>;
	jobs: Readonly<
		Record<
			string,
			Readonly<{
				strategy?: Readonly<{
					matrix?: Readonly<Record<string, readonly string[]>>;
				}>;
			}>
		>
	>;
}>;

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const workflow = Bun.YAML.parse(
	readFileSync(
		join(ROOT, ".github", "workflows", "release-evidence.yml"),
		"utf-8",
	),
) as Workflow;

const CTX: GateContext = {
	now: new Date("2026-09-30T12:00:00Z"),
	marketplaces: ["claude", "cursor", "codex"],
	workers: ["claude", "codex"],
	escapeCases: 60,
	actionRiskBackend: "system1",
	runLink: "https://github.com/mainahq/maina/actions/runs/1",
};

const matrix = workflow.jobs.e2e?.strategy?.matrix ?? {};

/** Real-config matrix cases one repetition of every e2e cell records. */
const runsPerRepetition =
	(matrix.os?.length ?? 0) *
	(matrix.host?.length ?? 0) *
	(matrix.path?.length ?? 0) *
	ENV_MODES.length;

/** The nightly default in `E2E_REPETITIONS` (`github.event_name == 'schedule' && 'N'`). */
function scheduledRepetitions(): number {
	const found = /github\.event_name == 'schedule' && '(\d+)'/.exec(
		workflow.env.E2E_REPETITIONS ?? "",
	);
	return found ? Number(found[1]) : 0;
}

/** The e2e-matrix verdict for a run in which every one of `runs` passed. */
function e2eGate(runs: number) {
	const evidence = new Map<string, string | undefined>([
		[
			"e2e-matrix.json",
			JSON.stringify({
				link: "https://github.com/mainahq/maina/actions/runs/1",
				runs,
				passed: runs,
			}),
		],
	]);
	const commands = new Map(
		GATE_ITEMS.filter((i) => i.source.kind === "command").map(
			(i) => [i.id, { code: 0, stdout: "", stderr: "" }] as const,
		),
	);
	const report = evaluateGates({ evidence, commands, ctx: CTX });
	return report.items.find((i) => i.id === "e2e-matrix");
}

describe("release-evidence.yml e2e repetitions", () => {
	test("the e2e cells are every host × install path on Linux and macOS", () => {
		expect(matrix.os).toEqual(["ubuntu-latest", "macos-latest"]);
		expect(matrix.host).toEqual([...HOSTS]);
		expect(matrix.path).toEqual([...INSTALL_PATHS]);
		expect(runsPerRepetition).toBe(72);
	});

	test("the workflow runs nightly", () => {
		expect(workflow.on.schedule?.length).toBeGreaterThan(0);
	});

	test("the nightly run records enough e2e runs for the gate", () => {
		const runs = scheduledRepetitions() * runsPerRepetition;
		expect(runs).toBeGreaterThanOrEqual(THRESHOLDS.e2e.minRuns);
		const gate = e2eGate(runs);
		expect(gate?.status).toBe("pass");
	});

	test("an on-demand dispatch's default records enough e2e runs for the gate", () => {
		const reps = Number(
			workflow.on.workflow_dispatch?.inputs?.e2e_repetitions?.default,
		);
		expect(e2eGate(reps * runsPerRepetition)?.status).toBe("pass");
	});
});

describe("the e2e-matrix gate on one evidence run", () => {
	test("the 14-repetition run (1,008 runs, all passed) passes", () => {
		const gate = e2eGate(14 * 72);
		expect(gate?.status).toBe("pass");
		expect(gate?.details.join("\n")).toMatch(/100\.0% of 1,008 runs passed/);
	});

	test("the old 2-repetition nightly (144 runs) fails on the run count", () => {
		const gate = e2eGate(2 * 72);
		expect(gate?.status).toBe("fail");
		expect(gate?.details.join("\n")).toMatch(
			/144 runs recorded \(need ≥ 1,000\)/,
		);
	});
});
