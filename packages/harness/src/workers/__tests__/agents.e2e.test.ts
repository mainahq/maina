/**
 * Nightly smoke against the real agents (FR-HAR-1): each one named in
 * `MAINA_AGENT_SMOKE` (comma-separated worker names) must resolve from PATH
 * and finish a trivial ACP turn. Needs the agent installed and its
 * credentials in the environment, so it is skipped unless asked for; see
 * .github/workflows/harness-agents-nightly.yml.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRun } from "../../orchestrator";
import { resolveWorker } from "../registry";

const requested = (process.env.MAINA_AGENT_SMOKE ?? "")
	.split(",")
	.map((name) => name.trim())
	.filter((name) => name !== "");

const TURN_MS = 180_000;

describe.skipIf(requested.length === 0)("real agent smoke", () => {
	test.each(requested.map((name) => [name]))(
		"%s answers one turn over ACP",
		async (name) => {
			const worker = resolveWorker(name);
			if (!worker.ok) {
				throw new Error(
					`${worker.error.message}${worker.error.hint ? `\n  ${worker.error.hint}` : ""}`,
				);
			}
			expect(worker.value.protocol).toBe("acp");
			const root = realpathSync(mkdtempSync(join(tmpdir(), "maina-smoke-")));
			const run = startRun({
				agent: worker.value.launch,
				task: "Reply with the single word OK. Do not use any tools.",
				root,
				// The turn needs no tools: anything the agent asks for is denied.
				policy: () => "deny",
				budgets: { wallClockMs: TURN_MS - 10_000 },
			});
			const end = await run.done;
			expect(end).toMatchObject({ type: "end", state: "completed" });
		},
		TURN_MS,
	);
});
