/// <reference types="bun-types" />

/**
 * Guards the temporary v1 scheduler workflow (#571).
 *
 * GitHub only fires `schedule` triggers from the default branch, so until
 * v1/main merges to master a scheduler on master dispatches the v1
 * workflows with `--ref v1/main` on their own crons.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

	test("holds only the permissions dispatch needs", () => {
		const { wf } = load();
		expect(wf.permissions).toEqual({ actions: "write", contents: "read" });
	});
});
