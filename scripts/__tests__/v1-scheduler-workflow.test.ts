/// <reference types="bun-types" />

/**
 * Guards the temporary v1 scheduler workflow (#571).
 *
 * GitHub only fires `schedule` triggers from the default branch, so until
 * v1/main merges to master a scheduler on master dispatches the v1
 * workflows with `--ref v1/main` on their own crons.
 */

import { describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORKFLOW = join(
	import.meta.dir,
	"..",
	"..",
	".github",
	"workflows",
	"v1-scheduler.yml",
);

interface Workflow {
	on: {
		schedule: Array<{ cron: string }>;
		workflow_dispatch?: unknown;
	};
	permissions: Record<string, string>;
	jobs: Record<string, { steps: Array<{ run?: string }> }>;
}

function load(): { raw: string; wf: Workflow } {
	const raw = readFileSync(WORKFLOW, "utf8");
	return { raw, wf: Bun.YAML.parse(raw) as Workflow };
}

describe("v1 scheduler workflow", () => {
	test("runs on the release-evidence and dogfood-report crons", () => {
		const { wf } = load();
		const crons = wf.on.schedule.map((s) => s.cron).sort();
		expect(crons).toEqual(["15 4 * * *", "30 6 * * 1"]);
		expect(wf.on.workflow_dispatch).toBeDefined();
	});

	test("dispatches both v1 workflows against v1/main", () => {
		const { raw } = load();
		expect(raw).toContain("release-evidence.yml");
		expect(raw).toContain("dogfood-report.yml");
		expect(raw).toContain("--ref v1/main");
		expect(raw).toContain("gh workflow run");
	});

	test("maps each cron to its workflow", () => {
		const { raw } = load();
		expect(raw).toMatch(/"15 4 \* \* \*"\)[^\n]*release-evidence\.yml/);
		expect(raw).toMatch(/"30 6 \* \* 1"\)[^\n]*dogfood-report\.yml/);
	});

	test("keeps the nightly evidence run at its scheduled repetitions", () => {
		// release-evidence.yml runs 2 repetitions on `schedule` but defaults
		// to 14 on `workflow_dispatch`; the nightly dispatch must stay at 2.
		const { raw } = load();
		expect(raw).toContain("-f e2e_repetitions=2");
	});

	test("stands down once the target workflow is on the default branch", () => {
		const { raw } = load();
		expect(raw).toContain("default_branch");
		expect(raw).toContain("contents/.github/workflows/");
	});

	test("dispatches only on a definite 404, never on an API error", () => {
		// A failed lookup must not read as "absent": that would double-run
		// the workflow once it is on the default branch.
		const { raw } = load();
		expect(raw).toMatch(/^\s*404\)[^\n]*;;/m);
		expect(raw).toMatch(/^\s*200\)[^\n]*exit 0/m);
		expect(raw).toMatch(/^\s*\*\)[^\n]*::error::[^\n]*exit 1/m);
	});

	test("holds only the permissions dispatch needs", () => {
		const { wf } = load();
		expect(wf.permissions).toEqual({ actions: "write", contents: "read" });
	});
});

// A stand-in for `gh` that answers each call from FAKE_* env vars and logs
// its arguments, one call per line.
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
case "$1 $2" in
  "api -i")
    [ -n "$FAKE_CONTENTS_STATUS" ] || exit 1
    echo "HTTP/2.0 $FAKE_CONTENTS_STATUS X"
    [ "$FAKE_CONTENTS_STATUS" = 200 ] || exit 1 ;;
  "run list")
    [ "\${FAKE_RUN_LIST_FAIL:-}" = 1 ] && exit 1
    echo "\${FAKE_ACTIVE_RUNS:-0}" ;;
  "workflow run") ;;
  api\\ *)
    [ -n "$FAKE_DEFAULT_BRANCH" ] || exit 1
    echo "$FAKE_DEFAULT_BRANCH" ;;
esac
`;

interface StepRun {
	exitCode: number;
	calls: string[];
	output: string;
}

/**
 * Runs the dispatch step's script the way Actions does (`bash -e`), with
 * the stub `gh` first on PATH.
 */
function runStep(env: Record<string, string>): StepRun {
	const { wf } = load();
	const script = wf.jobs.dispatch?.steps[0]?.run ?? "";
	const dir = mkdtempSync(join(tmpdir(), "v1-scheduler-"));
	const bin = join(dir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "gh"), FAKE_GH);
	chmodSync(join(bin, "gh"), 0o755);
	writeFileSync(join(dir, "step.sh"), script);
	const log = join(dir, "gh.log");
	writeFileSync(log, "");
	const proc = Bun.spawnSync(["bash", "-e", join(dir, "step.sh")], {
		env: {
			PATH: `${bin}:${process.env.PATH ?? ""}`,
			GH_LOG: log,
			GH_REPO: "mainahq/maina",
			GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
			DEFAULT_BRANCH: "master",
			SCHEDULE: "",
			PICKED: "",
			FAKE_CONTENTS_STATUS: "404",
			FAKE_DEFAULT_BRANCH: "master",
			...env,
		},
	});
	return {
		exitCode: proc.exitCode ?? -1,
		calls: readFileSync(log, "utf8").split("\n").filter(Boolean),
		output: proc.stdout.toString() + proc.stderr.toString(),
	};
}

function dispatched(r: StepRun): string[] {
	return r.calls.filter((c) => c.startsWith("workflow run"));
}

describe("v1 scheduler dispatch step", () => {
	test("nightly cron dispatches release-evidence on v1/main at 2 repetitions", () => {
		const r = runStep({ SCHEDULE: "15 4 * * *" });
		expect(r.exitCode).toBe(0);
		expect(dispatched(r)).toEqual([
			"workflow run release-evidence.yml --ref v1/main -f e2e_repetitions=2",
		]);
	});

	test("Monday cron dispatches dogfood-report on v1/main", () => {
		const r = runStep({ SCHEDULE: "30 6 * * 1" });
		expect(r.exitCode).toBe(0);
		expect(dispatched(r)).toEqual([
			"workflow run dogfood-report.yml --ref v1/main",
		]);
	});

	test("stands down when the target is on the default branch", () => {
		const r = runStep({
			SCHEDULE: "30 6 * * 1",
			FAKE_CONTENTS_STATUS: "200",
		});
		expect(r.exitCode).toBe(0);
		expect(dispatched(r)).toEqual([]);
	});

	test("fails without dispatching when the lookup errors", () => {
		for (const status of ["500", ""]) {
			const r = runStep({
				SCHEDULE: "30 6 * * 1",
				FAKE_CONTENTS_STATUS: status,
			});
			expect(r.exitCode).not.toBe(0);
			expect(dispatched(r)).toEqual([]);
		}
	});

	test("looks the default branch up when the event payload has none", () => {
		// A schedule event's payload need not carry `repository`, so
		// DEFAULT_BRANCH can arrive empty.
		const r = runStep({ SCHEDULE: "30 6 * * 1", DEFAULT_BRANCH: "" });
		expect(r.exitCode).toBe(0);
		expect(r.calls).toContain("api repos/mainahq/maina --jq .default_branch");
		expect(r.calls.some((c) => c.includes("?ref=master"))).toBe(true);
		expect(dispatched(r)).toHaveLength(1);
	});

	test("fails without dispatching when the default branch is unknown", () => {
		const r = runStep({
			SCHEDULE: "30 6 * * 1",
			DEFAULT_BRANCH: "",
			FAKE_DEFAULT_BRANCH: "",
		});
		expect(r.exitCode).not.toBe(0);
		expect(dispatched(r)).toEqual([]);
	});

	test("rejects a workflow outside the two v1 workflows", () => {
		for (const picked of ["", "release.yml", "../ci.yml"]) {
			const r = runStep({ PICKED: picked });
			expect(r.exitCode).not.toBe(0);
			expect(r.calls).toEqual([]);
		}
	});

	test("manual trigger dispatches the picked workflow", () => {
		const r = runStep({ PICKED: "dogfood-report.yml" });
		expect(r.exitCode).toBe(0);
		expect(dispatched(r)).toEqual([
			"workflow run dogfood-report.yml --ref v1/main",
		]);
	});

	test("does not cancel an active on-demand release-evidence run", () => {
		// release-evidence.yml cancels in-progress runs in its (event, ref)
		// concurrency group, so a nightly dispatch would kill an on-demand
		// run on v1/main, such as the 14-repetition release-gate run.
		const r = runStep({ SCHEDULE: "15 4 * * *", FAKE_ACTIVE_RUNS: "1" });
		expect(r.exitCode).toBe(0);
		expect(dispatched(r)).toEqual([]);
		expect(
			r.calls.some(
				(c) =>
					c.startsWith("run list --workflow release-evidence.yml") &&
					c.includes("--branch v1/main") &&
					c.includes("--event workflow_dispatch"),
			),
		).toBe(true);
	});

	test("fails without dispatching when active runs cannot be listed", () => {
		const r = runStep({ SCHEDULE: "15 4 * * *", FAKE_RUN_LIST_FAIL: "1" });
		expect(r.exitCode).not.toBe(0);
		expect(dispatched(r)).toEqual([]);
	});
});
