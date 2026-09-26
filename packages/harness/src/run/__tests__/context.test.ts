/**
 * Run contexts (FR-HAR-4): who is there to answer an `ask`.
 *
 * An unattended run has nobody to ask, so every `ask` is a `deny`, and it
 * never merges, releases or publishes, whatever the policy allows.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import {
	type ActionClassPolicy,
	DEFAULT_POLICY,
	type GateEvent,
	type Policy,
	UNATTENDED_DENIED_ACTION_CLASSES,
	VERDICTS,
	type Verdict,
} from "@mainahq/core";
import { testBridge } from "../../permissions/__tests__/gate-fixture";
import { type GateBridge, judgeActions } from "../../permissions/judge";
import {
	policyForContext,
	RUN_ENV,
	resolveRunContext,
	runCommand,
	sessionSandbox,
	verdictForContext,
} from "../context";

const ROOT = "/work/repo";

function shell(command: string): GateEvent {
	return {
		host: "acp:fake",
		sessionId: "s-1",
		root: ROOT,
		permissionMode: "default",
		untrusted: [],
		kind: "shell",
		action: { command },
	};
}

/** A seeded PRNG (mulberry32), so a failing case can be replayed. */
function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const pick = <T>(next: () => number, items: readonly T[]): T =>
	items[Math.floor(next() * items.length)] as T;

let bridge: GateBridge;
beforeAll(async () => {
	bridge = await testBridge(DEFAULT_POLICY);
});

describe("unattended: ask means deny", () => {
	test("an ask becomes a deny unattended and stays an ask interactively", () => {
		expect(verdictForContext("unattended", "ask")).toBe("deny");
		expect(verdictForContext("interactive", "ask")).toBe("ask");
		for (const context of ["interactive", "unattended"] as const) {
			expect(verdictForContext(context, "allow")).toBe("allow");
			expect(verdictForContext(context, "deny")).toBe("deny");
		}
	});

	test("an action the gate would ask about is denied in an unattended run", () => {
		const event = shell("rm -rf build");
		expect(judgeActions(bridge, [event], false).verdict).toBe("ask");
		expect(
			judgeActions({ ...bridge, context: "interactive" }, [event], false)
				.verdict,
		).toBe("ask");
		const unattended = judgeActions(
			{ ...bridge, context: "unattended" },
			[event],
			false,
		);
		expect(unattended.verdict).toBe("deny");
		expect(unattended.reason).toContain("unattended");
	});

	test("an unreadable action is denied, not asked about, in an unattended run", () => {
		expect(
			judgeActions({ ...bridge, context: "unattended" }, [], true).verdict,
		).toBe("deny");
		expect(
			judgeActions({ ...bridge, context: "interactive" }, [], true).verdict,
		).toBe("ask");
	});

	test("an allowed action stays allowed in an unattended run", () => {
		const judged = judgeActions(
			{ ...bridge, context: "unattended" },
			[shell("bun test")],
			false,
		);
		expect(judged.verdict).toBe("allow");
	});

	test("every class at ask is a deny in the unattended view of the policy", () => {
		const view = policyForContext(DEFAULT_POLICY, "unattended");
		for (const [id, spec] of Object.entries(DEFAULT_POLICY.action_classes)) {
			const expected: Verdict = spec.verdict === "ask" ? "deny" : spec.verdict;
			const denied = (
				UNATTENDED_DENIED_ACTION_CLASSES as readonly string[]
			).includes(id);
			expect([id, view.action_classes[id]?.verdict]).toEqual([
				id,
				denied ? "deny" : expected,
			]);
		}
		expect(policyForContext(DEFAULT_POLICY, "interactive")).toEqual(
			DEFAULT_POLICY,
		);
	});
});

// ── Merge, release, publish ────────────────────────────────────────────────

/** A command per class an unattended run must never perform. */
const FORBIDDEN_COMMANDS: Readonly<Record<string, readonly string[]>> = {
	"pr.merge": ["gh pr merge 12 --squash", "gh pr merge --auto --merge"],
	"git.push.protected": ["git push origin main", "git push origin HEAD:master"],
	"package.publish": ["npm publish", "gh release create v1.0.0"],
	deploy: ["vercel --prod", "wrangler deploy"],
};

/**
 * `policy` loosened every way a layer can: the class set to `allow`, marked
 * reversible, recorded as a trusted user loosening, and an allow rule for
 * each command, as knobs a random case turns on or off.
 */
function permissive(
	base: Policy,
	next: () => number,
	commands: readonly string[],
): Policy {
	const classes: Record<string, ActionClassPolicy> = {
		...base.action_classes,
	};
	const loosened: Policy["loosened"][number][] = [...base.loosened];
	for (const id of UNATTENDED_DENIED_ACTION_CLASSES) {
		classes[id] = {
			irreversible: next() < 0.5,
			verdict: pick(next, VERDICTS),
		};
		if (next() < 0.5) {
			loosened.push({ actionClass: id, source: "user", before: "ask" });
		}
	}
	const allow =
		next() < 0.7 ? commands.map((match) => ({ match })) : base.rules.allow;
	const run =
		next() < 0.3
			? {
					...base.run,
					unattended: { ...base.run.unattended, deny: [] },
				}
			: base.run;
	return {
		...base,
		action_classes: classes,
		loosened,
		rules: { ...base.rules, allow },
		run,
	};
}

describe("unattended runs never merge, release or publish (property)", () => {
	const SEED = 0x4b7320;
	const RUNS = 300;
	const all = Object.values(FORBIDDEN_COMMANDS).flat();

	test("each class is denied in the unattended view, however the policy sets it", () => {
		for (const id of UNATTENDED_DENIED_ACTION_CLASSES) {
			for (const verdict of VERDICTS) {
				for (const irreversible of [true, false]) {
					for (const loosen of [true, false]) {
						const policy: Policy = {
							...DEFAULT_POLICY,
							action_classes: {
								...DEFAULT_POLICY.action_classes,
								[id]: { irreversible, verdict },
							},
							loosened: loosen
								? [{ actionClass: id, source: "user", before: "ask" }]
								: [],
							// A hand-built policy that forgot the built-in list.
							run: {
								...DEFAULT_POLICY.run,
								unattended: { ...DEFAULT_POLICY.run.unattended, deny: [] },
							},
						};
						const view = policyForContext(policy, "unattended");
						expect([
							id,
							verdict,
							irreversible,
							loosen,
							view.action_classes[id],
						]).toEqual([
							id,
							verdict,
							irreversible,
							loosen,
							{ irreversible: true, verdict: "deny" },
						]);
						expect(view.loosened.map((l) => l.actionClass)).not.toContain(id);
					}
				}
			}
		}
	});

	test(`${RUNS} random permissive policies: the gate denies every merge, release and publish, seed ${SEED}`, () => {
		const next = prng(SEED);
		for (let i = 0; i < RUNS; i++) {
			const command = pick(next, all);
			const policy = permissive(DEFAULT_POLICY, next, all);
			const judged = judgeActions(
				{ ...bridge, policy, context: "unattended" },
				[shell(command)],
				false,
			);
			expect([i, command, judged.verdict]).toEqual([i, command, "deny"]);
		}
	});

	test("the same commands can still be allowed in an interactive run", () => {
		for (const [id, commands] of Object.entries(FORBIDDEN_COMMANDS)) {
			const policy: Policy = {
				...DEFAULT_POLICY,
				action_classes: {
					...DEFAULT_POLICY.action_classes,
					[id]: { irreversible: false, verdict: "allow" },
				},
				// The user stands behind the loosening, so the gate keeps it.
				loosened: [{ actionClass: id, source: "user", before: "ask" }],
				rules: {
					...DEFAULT_POLICY.rules,
					allow: commands.map((match) => ({ match })),
				},
			};
			for (const command of commands) {
				const judged = judgeActions(
					{ ...bridge, policy, context: "interactive" },
					[shell(command)],
					false,
				);
				expect([command, judged.verdict]).toEqual([command, "allow"]);
			}
		}
	});

	test("a class the policy adds to a context's deny list is denied there", () => {
		const policy: Policy = {
			...DEFAULT_POLICY,
			run: {
				...DEFAULT_POLICY.run,
				interactive: { ...DEFAULT_POLICY.run.interactive, deny: ["pr.merge"] },
			},
		};
		const judged = judgeActions(
			{ ...bridge, policy, context: "interactive" },
			[shell("gh pr merge 12")],
			false,
		);
		expect(judged.verdict).toBe("deny");
	});
});

// ── Which context ──────────────────────────────────────────────────────────

describe("resolveRunContext", () => {
	test("an explicit choice wins", () => {
		expect(
			resolveRunContext({
				requested: "unattended",
				interactiveTerminal: true,
				ci: false,
			}),
		).toBe("unattended");
		expect(
			resolveRunContext({
				requested: "interactive",
				interactiveTerminal: false,
				ci: true,
			}),
		).toBe("interactive");
	});

	test("without one, a run is interactive only at a terminal outside CI", () => {
		expect(resolveRunContext({ interactiveTerminal: true, ci: false })).toBe(
			"interactive",
		);
		expect(resolveRunContext({ interactiveTerminal: false, ci: false })).toBe(
			"unattended",
		);
		expect(resolveRunContext({ interactiveTerminal: true, ci: true })).toBe(
			"unattended",
		);
	});
});

// ── Is this session sandboxed? (FR-SBX-6) ──────────────────────────────────

const envOf = (vars: Readonly<Record<string, string>>) => ({
	get: (name: string) => vars[name],
});

describe("sessionSandbox", () => {
	test("a plugin-only session inside an agent has no sandbox, and says how to get one", () => {
		const sandbox = sessionSandbox(envOf({ CLAUDECODE: "1" }));
		expect(sandbox).toEqual({
			state: "off",
			session: "plugin",
			host: "claude",
			command: runCommand("claude"),
		});
		expect(runCommand("claude")).toBe('maina run --agent claude "<task>"');
	});

	test("a session maina run started is sandboxed", () => {
		expect(
			sessionSandbox(
				envOf({
					CLAUDECODE: "1",
					[RUN_ENV.runId]: "r-7",
					[RUN_ENV.sandbox]: "1",
				}),
			),
		).toEqual({ state: "on", runId: "r-7" });
	});

	test("a plain terminal is no agent session: nothing to report", () => {
		expect(sessionSandbox(envOf({}))).toBeUndefined();
	});

	test("other agents are recognised too", () => {
		expect(sessionSandbox(envOf({ GEMINI_CLI: "1" }))).toMatchObject({
			state: "off",
			host: "gemini",
			command: runCommand("gemini"),
		});
	});
});
