/**
 * The suite runs per ACP worker (spec §9.6, #569): each run installs that
 * worker's gate integration, so its prompt-injection cases attack the files
 * that worker's gate relies on, and the run record names the worker.
 *
 * Nothing here needs the sandbox runtime: building a worker's harness and
 * the unsandboxed control (every gate attack lands with no sandbox, so each
 * worker's cases have teeth) run anywhere.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { WORKER_NAMES } from "../../../packages/harness/src/workers/registry";
import { ESCAPE_CASES } from "../cases";
import { harnessFor, runCase, suiteWorkers } from "../runner";

describe("suiteWorkers", () => {
	test("every supported worker by default, and for `all`", () => {
		expect(suiteWorkers(undefined)).toEqual({ ok: true, value: WORKER_NAMES });
		expect(suiteWorkers("all")).toEqual({ ok: true, value: WORKER_NAMES });
	});

	test("a comma-separated subset, in the order given", () => {
		expect(suiteWorkers("gemini, codex")).toEqual({
			ok: true,
			value: ["gemini", "codex"],
		});
	});

	test("an unknown worker is an error naming the supported ones", () => {
		const r = suiteWorkers("codex,aider");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.code).toBe("unknown_worker");
			expect(r.error.message).toContain("aider");
			expect(r.error.message).toContain("opencode");
		}
	});
});

describe("harnessFor", () => {
	for (const worker of WORKER_NAMES) {
		test(`${worker}: its gate integration is installed and guarded`, () => {
			const harness = harnessFor(worker);
			try {
				const { ctx, sandbox } = harness;
				expect(ctx.worker).toBe(worker);
				expect(ctx.gateDir.startsWith(`${ctx.layout.worktree}/`)).toBe(true);
				expect(ctx.settingsPath.startsWith(`${ctx.gateDir}/`)).toBe(true);
				expect(existsSync(ctx.settingsPath)).toBe(true);
				expect(ctx.settingsBefore.length).toBeGreaterThan(0);
				expect(ctx.policyBefore.length).toBeGreaterThan(0);
				expect(sandbox.writeDeny).toContain(ctx.gateDir);
				expect(sandbox.writeDeny).toContain(ctx.policyPath);
			} finally {
				harness.dispose();
			}
			expect(existsSync(join(harness.ctx.layout.base))).toBe(false);
		});
	}
});

describe("each worker's gate attacks have teeth", () => {
	const gateCases = ESCAPE_CASES.filter(
		(c) => c.category === "prompt-injection",
	);
	for (const worker of WORKER_NAMES) {
		test(`${worker}: every prompt injection lands unsandboxed`, async () => {
			for (const esc of gateCases) {
				const r = await runCase(esc, "unsandboxed", worker);
				expect({ id: r.id, worker: r.worker, escaped: r.escaped }).toEqual({
					id: esc.id,
					worker,
					escaped: true,
				});
			}
		});
	}
});
