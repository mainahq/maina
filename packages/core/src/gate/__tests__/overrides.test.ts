/**
 * Recorded overrides (FR-GATE-8, FR-DEC-4). Overriding a gate decision links
 * an `override` outcome to the logged decision; remembering it writes a
 * scoped allow rule to the user policy, never to the repo policy.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { migrateGateSubjects } from "../../db/gate-subjects";
import {
	logDecision,
	outcomePorts,
	unwrap,
} from "../../decide/outcomes/__tests__/fixtures";
import { queryOutcomes } from "../../decide/outcomes/link";
import { DEFAULT_REGISTRY } from "../../decide/registry";
import { DEFAULT_POLICY } from "../../policy/defaults";
import { loadPolicy, userPolicyFile } from "../../policy/load";
import { createMemoryFs } from "../../ports/testing";
import { evaluateGate } from "../evaluate";
import type { GateContext } from "../events";
import {
	findGateSubject,
	type GateSubject,
	gateSubject,
	recordGateSubject,
	recordOverride,
	rememberOverride,
	scopedAllowRules,
	withUserRules,
} from "../overrides";
import {
	gateContext,
	mcpEvent,
	networkEvent,
	ROOT,
	shellEvent,
	writeEvent,
} from "./helpers";

const HOME = "/home/dev";

let ctx: GateContext;
beforeAll(async () => {
	ctx = await gateContext();
});

function subject(overrides: Partial<GateSubject> = {}): GateSubject {
	return {
		decisionId: "d-1",
		kind: "shell",
		targets: ["git push origin main"],
		classes: ["git.push", "git.push.protected"],
		rule: "ask",
		irreversible: false,
		...overrides,
	};
}

describe("recordOverride", () => {
	test("an override links an `override` outcome to the logged decision", () => {
		const ports = outcomePorts();
		logDecision(ports.db, { id: "d-1", type: "action.risk" });
		const record = unwrap(recordOverride(ports, "d-1"));
		expect(record.outcome).toBe("override");
		expect(record.decisionId).toBe("d-1");
		expect(record.source).toBe("gate");
		const stored = unwrap(queryOutcomes(ports, { decisionId: "d-1" }));
		expect(stored.map((o) => o.outcome)).toEqual(["override"]);
	});

	test("overriding the same decision twice links one outcome", () => {
		const ports = outcomePorts();
		logDecision(ports.db, { id: "d-1", type: "action.risk" });
		unwrap(recordOverride(ports, "d-1"));
		unwrap(recordOverride(ports, "d-1"));
		expect(unwrap(queryOutcomes(ports, { decisionId: "d-1" }))).toHaveLength(1);
	});

	test("an unknown decision is an error, not a silent no-op", () => {
		const result = recordOverride(outcomePorts(), "nope");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toEqual({
				kind: "outcome",
				error: { kind: "unknown_decision", decisionId: "nope" },
			});
		}
	});
});

describe("gateSubject", () => {
	test("a shell line's subject is every command in it, as the rules see them", () => {
		const s = gateSubject(
			"d-9",
			shellEvent("bun run build && bun test"),
			DEFAULT_POLICY,
			ctx,
		);
		expect(s.decisionId).toBe("d-9");
		expect(s.kind).toBe("shell");
		expect(s.targets).toEqual(["bun run build", "bun test"]);
		expect(s.irreversible).toBe(false);
	});

	test("an irreversible class marks the subject irreversible", () => {
		const s = gateSubject(
			"d-2",
			shellEvent("git push --force origin main"),
			DEFAULT_POLICY,
			ctx,
		);
		expect(s.irreversible).toBe(true);
		expect(s.rule).toBe("ask");
	});

	test("non-shell subjects target the exact path, tool or URL", () => {
		expect(
			gateSubject("d", writeEvent(`${ROOT}/a.ts`), DEFAULT_POLICY, ctx).targets,
		).toEqual([`${ROOT}/a.ts`]);
		expect(
			gateSubject("d", mcpEvent("github", "create_issue"), DEFAULT_POLICY, ctx)
				.targets,
		).toEqual(["github/create_issue"]);
		expect(
			gateSubject(
				"d",
				networkEvent("https://api.example.com/v1"),
				DEFAULT_POLICY,
				ctx,
			).targets,
		).toEqual(["https://api.example.com/v1"]);
	});
});

describe("scopedAllowRules", () => {
	test("one exact rule per target, scoped to the event kind", () => {
		const rules = unwrap(
			scopedAllowRules(subject({ targets: ["bun run build", "bun test"] })),
		);
		expect(rules).toEqual([
			{
				match: "bun run build",
				kind: "shell",
				reason: "allowed with maina allow d-1 --always",
			},
			{
				match: "bun test",
				kind: "shell",
				reason: "allowed with maina allow d-1 --always",
			},
		]);
	});

	test("an irreversible action cannot be remembered: no allow rule reaches it", () => {
		const result = scopedAllowRules(subject({ irreversible: true }));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("not_scopable");
	});

	test("a deny rule or class is final, so an allow rule would do nothing", () => {
		const result = scopedAllowRules(subject({ rule: "deny" }));
		expect(result.ok).toBe(false);
	});

	test("an opaque command or a wildcard target cannot be scoped", () => {
		expect(scopedAllowRules(subject({ classes: ["shell.opaque"] })).ok).toBe(
			false,
		);
		expect(scopedAllowRules(subject({ targets: ["ls *.ts"] })).ok).toBe(false);
		expect(scopedAllowRules(subject({ targets: [] })).ok).toBe(false);
	});
});

describe("withUserRules", () => {
	const rule = { match: "bun test", kind: "shell", reason: "r" } as const;

	test("starts a user layer when there is none", () => {
		const out = unwrap(withUserRules(undefined, [rule]));
		expect(out.added).toBe(1);
		expect(out.layer).toEqual({ rules: { allow: [rule] } });
	});

	test("keeps every other key and rule, and adds a rule only once", () => {
		const existing = {
			$schema: "x",
			telemetry: { usage: true },
			rules: { allow: [rule], deny: [{ match: "rm -rf /" }] },
		};
		const out = unwrap(withUserRules(existing, [rule]));
		expect(out.added).toBe(0);
		expect(out.layer).toEqual(existing);
	});

	test("an invalid user policy is reported, never overwritten", () => {
		const result = withUserRules({ rules: { allow: "nope" } }, [rule]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("policy");
	});
});

describe("rememberOverride", () => {
	const repoPolicy = `${ROOT}/.maina/policy.json`;

	test("writes the rules to the user policy, never the repo policy", async () => {
		const repoContent = JSON.stringify({ rules: { deny: [] } });
		const fs = createMemoryFs({ [repoPolicy]: repoContent });
		const rules = unwrap(scopedAllowRules(subject()));
		const out = unwrap(await rememberOverride({ fs }, HOME, rules));
		expect(out.file).toBe(userPolicyFile(HOME));
		expect(out.file.startsWith(ROOT)).toBe(false);
		expect(unwrap(await fs.readFile(repoPolicy))).toBe(repoContent);
		const user = JSON.parse(unwrap(await fs.readFile(userPolicyFile(HOME))));
		expect(user.rules.allow).toEqual(rules);
	});

	test("backs up an existing user policy before the first write", async () => {
		const original = JSON.stringify({ telemetry: { usage: true } });
		const fs = createMemoryFs({ [userPolicyFile(HOME)]: original });
		unwrap(
			await rememberOverride({ fs }, HOME, unwrap(scopedAllowRules(subject()))),
		);
		expect(unwrap(await fs.readFile(`${userPolicyFile(HOME)}.bak`))).toBe(
			original,
		);
	});

	test("the remembered rule allows the action on the next evaluation", async () => {
		const fs = createMemoryFs({});
		const event = shellEvent("git push origin main");
		const ports = {
			clock: { now: () => 0 },
			backends: DEFAULT_REGISTRY,
			ctx,
			newId: () => "x",
		};
		const before = evaluateGate(ports, event, DEFAULT_POLICY);
		expect(before.verdict).toBe("ask");
		const s = gateSubject("d-1", event, DEFAULT_POLICY, ctx);
		unwrap(await rememberOverride({ fs }, HOME, unwrap(scopedAllowRules(s))));
		const userLayer = JSON.parse(
			unwrap(await fs.readFile(userPolicyFile(HOME))),
		);
		const policy = unwrap(await loadPolicy({ fs }, ROOT, userLayer));
		const after = evaluateGate(ports, event, policy);
		expect(after.verdict).toBe("allow");
	});
});

describe("gate subject store", () => {
	test("a recorded subject is found by its decision id", () => {
		const { db } = outcomePorts();
		unwrap(migrateGateSubjects(db));
		const s = subject({ targets: ["a", "b"] });
		unwrap(recordGateSubject(db, s));
		unwrap(recordGateSubject(db, s));
		expect(unwrap(findGateSubject(db, "d-1"))).toEqual(s);
		expect(unwrap(findGateSubject(db, "d-404"))).toBeUndefined();
	});
});
