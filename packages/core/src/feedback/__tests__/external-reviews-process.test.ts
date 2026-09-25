/** Issue #433: PR review ingestion calls `gh` through a `ProcessPort`. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeProcess } from "../../ports/testing";
import { ingestPrReviews } from "../external-reviews";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe("ingestPrReviews over an injected ProcessPort", () => {
	test("pulls review and issue comments with `gh api` in the given cwd", async () => {
		const root = mkdtempSync(join(tmpdir(), "maina-extrev-proc-"));
		dirs.push(root);
		const review = {
			id: 1,
			path: "src/a.ts",
			line: 4,
			body: "This export doesn't exist on the module",
			user: { login: "copilot-pull-request-reviewer" },
		};
		const proc = createFakeProcess({
			"gh api repos/o/r/pulls/7/comments --paginate --slurp": {
				stdout: JSON.stringify([[review]]),
			},
			"gh api repos/o/r/issues/7/comments --paginate --slurp": {
				stdout: "[[]]",
			},
		});

		const result = await ingestPrReviews(join(root, ".maina"), {
			repo: "o/r",
			prNumbers: [7],
			cwd: root,
			process: proc,
		});

		expect(result).toEqual({ ok: true, value: { ingested: 1, skipped: 0 } });
		expect(proc.calls().map((c) => c.options.cwd)).toEqual([root, root]);
	});

	test("a failing `gh` surfaces its stderr as the error", async () => {
		const proc = createFakeProcess(() => ({
			ok: true,
			value: { exitCode: 1, stdout: "", stderr: "gh: not logged in\n" },
		}));
		const result = await ingestPrReviews("/nowhere/.maina", {
			repo: "o/r",
			prNumbers: [7],
			cwd: "/nowhere",
			process: proc,
		});
		expect(result).toEqual({ ok: false, error: "gh: not logged in" });
	});
});
