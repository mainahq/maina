import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY, type EnvPort, type Policy } from "@mainahq/core";
import {
	type PrepareInput,
	type RunActionDeps,
	type RunActionOptions,
	runAction,
} from "../run";

const envOf = (vars: Readonly<Record<string, string>>): EnvPort => ({
	get: (name) => vars[name],
});

type Recorder = {
	prepared: PrepareInput[];
	written: Array<{ path: string; content: string }>;
};

function deps(
	overrides: Partial<RunActionDeps> = {},
	reviews: readonly boolean[] = [true],
): { deps: RunActionDeps; seen: Recorder } {
	const seen: Recorder = { prepared: [], written: [] };
	let reviewed = 0;
	return {
		seen,
		deps: {
			interactiveTerminal: false,
			env: envOf({}),
			repoRoot: async (cwd) => ({ ok: true, value: cwd }),
			loadPolicy: async () => ({ ok: true, value: DEFAULT_POLICY }),
			newRunId: () => "run-1",
			prepare: async (input) => {
				seen.prepared.push(input);
				return {
					ok: true,
					value: {
						worktree: { path: "/wt/run-1", branch: "maina/run/run-1" },
						ports: {
							attempt: async () => ({
								end: {
									type: "end",
									state: "completed",
									stopReason: "end_turn",
								},
								toolCalls: 1,
							}),
							review: async () => {
								const passed = reviews[reviewed] ?? false;
								reviewed++;
								return { passed, findings: passed ? [] : ["lint: x"] };
							},
							now: () => 0,
						},
					},
				};
			},
			writeFile: async (path, content) => {
				seen.written.push({ path, content });
				return { ok: true, value: undefined };
			},
			...overrides,
		},
	};
}

const options: RunActionOptions = {
	task: "fix the bug",
	agent: "claude",
	cwd: "/repo",
};

describe("runAction", () => {
	test("the prepared run is released once the agent is done, before the receipt (#544)", async () => {
		for (const writeOk of [true, false]) {
			const events: string[] = [];
			const base = deps({
				writeFile: async () => {
					events.push("write");
					return writeOk
						? { ok: true, value: undefined }
						: {
								ok: false,
								error: { kind: "io", path: "/x", message: "disk full" },
							};
				},
			});
			const prepare = base.deps.prepare;
			const d: RunActionDeps = {
				...base.deps,
				prepare: async (input) => {
					const prepared = await prepare(input);
					if (!prepared.ok) return prepared;
					return {
						ok: true,
						value: {
							...prepared.value,
							release: async () => {
								events.push("release");
							},
						},
					};
				},
			};
			const result = await runAction(options, d);
			expect(result.ok).toBe(writeOk);
			expect(events).toEqual(["release", "write"]);
		}
	});

	test("with no terminal the run is unattended, bounded by the policy's unattended budgets", async () => {
		const { deps: d, seen } = deps();
		const result = await runAction(options, d);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(seen.prepared).toHaveLength(1);
		expect(seen.prepared[0]).toMatchObject({
			root: "/repo",
			runId: "run-1",
			agent: "claude",
			context: "unattended",
		});
		expect(result.receipt).toMatchObject({
			status: "passed",
			context: "unattended",
			budgets: { wallClockMs: 3_600_000, maxToolCalls: 500 },
		});
	});

	test("CI makes a run unattended even at a terminal; --interactive overrides", async () => {
		const ci = deps({ interactiveTerminal: true, env: envOf({ CI: "true" }) });
		await runAction(options, ci.deps);
		expect(ci.seen.prepared[0]?.context).toBe("unattended");

		const forced = deps({ interactiveTerminal: false });
		await runAction({ ...options, context: "interactive" }, forced.deps);
		expect(forced.seen.prepared[0]?.context).toBe("interactive");
	});

	test("the receipt is written under .maina/runs, stopped runs included", async () => {
		const { deps: d, seen } = deps({}, [false, false]);
		const result = await runAction(options, d);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.receipt.status).toBe("stopped");
		expect(result.receiptPath).toBe("/repo/.maina/runs/run-1.json");
		expect(seen.written).toHaveLength(1);
		const written = JSON.parse(seen.written[0]?.content ?? "{}");
		expect(written).toMatchObject({
			runId: "run-1",
			status: "stopped",
			reason: "review_failed",
			worktree: "/wt/run-1",
			branch: "maina/run/run-1",
		});
	});

	test("an invalid policy fails before anything starts", async () => {
		const { deps: d, seen } = deps({
			loadPolicy: async () => ({
				ok: false,
				error: [
					{
						kind: "invalid",
						source: "repo",
						file: "/repo/.maina/policy.json",
						path: "run.unattended.budgets.max_tool_calls",
						message: "Too small",
					},
				],
			}),
		});
		const result = await runAction(options, d);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("policy");
		expect(result.error.message).toContain(
			"run.unattended.budgets.max_tool_calls",
		);
		expect(seen.prepared).toHaveLength(0);
	});

	test("a run that cannot be sandboxed never starts", async () => {
		const { deps: d, seen } = deps({
			prepare: async () => ({
				ok: false,
				error: {
					message: "the sandbox runtime is not installed",
					hint: "npm i -g x",
				},
			}),
		});
		const result = await runAction(options, d);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toEqual({
			kind: "prepare",
			message: "the sandbox runtime is not installed",
			hint: "npm i -g x",
		});
		expect(seen.written).toHaveLength(0);
	});

	test("a user policy that lowers the unattended budget bounds the run", async () => {
		const policy: Policy = {
			...DEFAULT_POLICY,
			run: {
				...DEFAULT_POLICY.run,
				unattended: {
					...DEFAULT_POLICY.run.unattended,
					budgets: { max_tool_calls: 5 },
				},
			},
		};
		const { deps: d } = deps({
			loadPolicy: async () => ({ ok: true, value: policy }),
		});
		const result = await runAction(options, d);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.receipt.budgets).toEqual({ maxToolCalls: 5 });
	});
});
