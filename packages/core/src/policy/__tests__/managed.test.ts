/**
 * The managed policy layer (#592, cloud plan Task 6.3): a policy bundle the
 * cloud signed (or, while its signer is dark, marked unsigned) becomes the
 * `managed` layer. Merge order is defaults < managed < user < repo, and on an
 * enrolled machine the managed layer is a floor: a user or repo layer may
 * tighten what it sets, never loosen it. A loosening is not an error (the
 * gate must keep working); the managed value wins and the attempt is
 * reported, for `maina doctor`.
 */

import { describe, expect, test } from "bun:test";
import { createMemoryFs } from "../../ports/testing";
import { DEFAULT_POLICY } from "../defaults";
import { loadPolicy } from "../load";
import {
	activeBudgetDirectives,
	type ManagedBudgetDirective,
	type ManagedLayerInput,
	parseManagedLayer,
} from "../managed";

const ROOT = "/repo";
const POLICY_PATH = "/repo/.maina/policy.json";

function ports(repo?: unknown) {
	return {
		fs: createMemoryFs(
			repo === undefined ? {} : { [POLICY_PATH]: JSON.stringify(repo) },
		),
	};
}

function input(
	policy: unknown,
	overrides: Partial<ManagedLayerInput> = {},
): ManagedLayerInput {
	return {
		policy,
		version: 7,
		etag: `sha256:${"a".repeat(64)}`,
		signature: "signed",
		keyId: "key_policy_1",
		issuedAt: "2026-09-28T08:00:00.000Z",
		budgetDirectives: [],
		...overrides,
	};
}

function managed(policy: unknown, overrides: Partial<ManagedLayerInput> = {}) {
	const parsed = parseManagedLayer(input(policy, overrides));
	if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
	return parsed.value;
}

describe("parseManagedLayer", () => {
	test("accepts a signed v1 policy body as the managed layer", () => {
		const layer = managed({
			version: 1,
			action_classes: { deploy: { verdict: "deny" } },
		});
		expect(layer.value.action_classes?.deploy?.verdict).toBe("deny");
		expect(layer.version).toBe(7);
		expect(layer.signature).toBe("signed");
	});

	test("refuses a body that is not a valid policy, with its path", () => {
		const parsed = parseManagedLayer(
			input({ version: 1, action_classes: { deploy: { verdict: "maybe" } } }),
		);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error[0]?.source).toBe("managed");
		expect(parsed.error[0]?.path).toBe("action_classes.deploy.verdict");
	});

	test("a signed layer may loosen an irreversible class it lists in explicitly_allow", () => {
		const layer = managed({
			version: 1,
			explicitly_allow: ["deploy"],
			action_classes: { deploy: { verdict: "allow" } },
		});
		expect(layer.value.explicitly_allow).toEqual(["deploy"]);
	});

	describe("an unsigned bundle (the cloud's signer is dark)", () => {
		test("is accepted only to tighten", () => {
			const layer = managed(
				{ version: 1, action_classes: { deploy: { verdict: "deny" } } },
				{ signature: "unsigned", keyId: "unsigned" },
			);
			expect(layer.signature).toBe("unsigned");
			expect(layer.value.action_classes?.deploy?.verdict).toBe("deny");
		});

		test("never loosens an irreversible class, explicitly_allow or not", () => {
			const parsed = parseManagedLayer(
				input(
					{
						version: 1,
						explicitly_allow: ["deploy"],
						action_classes: { deploy: { verdict: "allow" } },
					},
					{ signature: "unsigned", keyId: "unsigned" },
				),
			);
			expect(parsed.ok).toBe(false);
			if (parsed.ok) return;
			expect(parsed.error.map((e) => [e.kind, e.path])).toContainEqual([
				"loosening",
				"action_classes.deploy.verdict",
			]);
		});

		test("cannot raise a run budget", () => {
			const parsed = parseManagedLayer(
				input(
					{
						version: 1,
						run: { unattended: { budgets: { max_tool_calls: 100_000 } } },
					},
					{ signature: "unsigned", keyId: "unsigned" },
				),
			);
			expect(parsed.ok).toBe(false);
			if (parsed.ok) return;
			expect(parsed.error[0]?.path).toBe(
				"run.unattended.budgets.max_tool_calls",
			);
		});
	});
});

describe("loadPolicy with a managed layer", () => {
	test("a machine that was never enrolled gets exactly the v1 policy", async () => {
		const user = { action_classes: { "git.push": { verdict: "ask" } } };
		const repo = { rules: { deny: [{ match: "git status" }] } };
		const before = await loadPolicy(ports(repo), ROOT, user);
		const after = await loadPolicy(ports(repo), ROOT, user, undefined);
		expect(after).toEqual(before);
		expect(after.ok && "managed" in after.value).toBe(false);
		const bare = await loadPolicy(ports(), ROOT, undefined, undefined);
		expect(bare).toEqual({ ok: true, value: DEFAULT_POLICY });
	});

	test("applies the managed layer between the defaults and the user layer", async () => {
		const layer = managed({
			version: 1,
			action_classes: { "deps.install": { verdict: "ask" } },
			rules: { deny: [{ match: "curl" }] },
		});
		const policy = await loadPolicy(ports(), ROOT, undefined, layer);
		if (!policy.ok) throw new Error(JSON.stringify(policy.error));
		expect(policy.value.action_classes["deps.install"]?.verdict).toBe("ask");
		expect(policy.value.rules.deny.map((r) => r.match)).toContain("curl");
		expect(policy.value.managed).toEqual({
			version: 7,
			etag: `sha256:${"a".repeat(64)}`,
			signature: "signed",
			keyId: "key_policy_1",
			issuedAt: "2026-09-28T08:00:00.000Z",
			budgetDirectives: [],
			overridden: [],
		});
	});

	test("a user layer that loosens a managed rule is reported, and the managed rule wins", async () => {
		const layer = managed({
			version: 1,
			action_classes: { "deps.install": { verdict: "ask" } },
		});
		const user = { action_classes: { "deps.install": { verdict: "allow" } } };
		const policy = await loadPolicy(ports(), ROOT, user, layer);
		if (!policy.ok) throw new Error(JSON.stringify(policy.error));
		expect(policy.value.action_classes["deps.install"]?.verdict).toBe("ask");
		expect(policy.value.managed?.overridden).toEqual([
			{
				source: "user",
				file: undefined,
				path: "action_classes.deps.install.verdict",
				managed: "ask",
				attempted: "allow",
			},
		]);
		// Unenrolled, the same user layer loosens it as it always has.
		const v1 = await loadPolicy(ports(), ROOT, user);
		expect(v1.ok && v1.value.action_classes["deps.install"]?.verdict).toBe(
			"allow",
		);
	});

	test("an explicitly_allow in the user layer cannot loosen what the managed layer tightened", async () => {
		const layer = managed({
			version: 1,
			action_classes: { deploy: { verdict: "deny" } },
		});
		const user = {
			explicitly_allow: ["deploy"],
			action_classes: { deploy: { verdict: "allow", irreversible: false } },
		};
		const policy = await loadPolicy(ports(), ROOT, user, layer);
		if (!policy.ok) throw new Error(JSON.stringify(policy.error));
		expect(policy.value.action_classes.deploy).toEqual({
			irreversible: true,
			verdict: "deny",
		});
		expect(policy.value.loosened).toEqual([]);
		expect(
			policy.value.managed?.overridden.map((o) => [o.source, o.path]),
		).toEqual([
			["user", "action_classes.deploy.verdict"],
			["user", "action_classes.deploy.irreversible"],
		]);
	});

	test("a repo layer is held to the same floor", async () => {
		const layer = managed({
			version: 1,
			action_classes: { "deps.install": { verdict: "deny" } },
		});
		const repo = { action_classes: { "deps.install": { verdict: "ask" } } };
		const policy = await loadPolicy(ports(repo), ROOT, undefined, layer);
		if (!policy.ok) throw new Error(JSON.stringify(policy.error));
		expect(policy.value.action_classes["deps.install"]?.verdict).toBe("deny");
		expect(policy.value.managed?.overridden).toEqual([
			{
				source: "repo",
				file: POLICY_PATH,
				path: "action_classes.deps.install.verdict",
				managed: "deny",
				attempted: "ask",
			},
		]);
	});

	test("tightening past the managed layer is allowed and not reported", async () => {
		const layer = managed({
			version: 1,
			action_classes: { "deps.install": { verdict: "ask" } },
		});
		const user = { action_classes: { "deps.install": { verdict: "deny" } } };
		const policy = await loadPolicy(ports(), ROOT, user, layer);
		if (!policy.ok) throw new Error(JSON.stringify(policy.error));
		expect(policy.value.action_classes["deps.install"]?.verdict).toBe("deny");
		expect(policy.value.managed?.overridden).toEqual([]);
	});

	test("classes the managed layer does not set keep the v1 rules", async () => {
		const layer = managed({
			version: 1,
			action_classes: { "deps.install": { verdict: "ask" } },
		});
		const user = { action_classes: { "network.fetch": { verdict: "ask" } } };
		const repo = { action_classes: { "network.fetch": { verdict: "allow" } } };
		const policy = await loadPolicy(ports(repo), ROOT, user, layer);
		if (!policy.ok) throw new Error(JSON.stringify(policy.error));
		expect(policy.value.action_classes["network.fetch"]?.verdict).toBe("allow");
		expect(policy.value.managed?.overridden).toEqual([]);
	});

	test("run budgets from the bundle are a ceiling for the user and repo layers", async () => {
		const layer = managed({
			version: 1,
			run: {
				interactive: { budgets: { max_tool_calls: 40 } },
				unattended: { budgets: { wall_clock_minutes: 20 } },
			},
		});
		const user = {
			run: {
				interactive: { budgets: { max_tool_calls: 400 } },
				unattended: { budgets: { wall_clock_minutes: 10 } },
			},
		};
		const policy = await loadPolicy(ports(), ROOT, user, layer);
		if (!policy.ok) throw new Error(JSON.stringify(policy.error));
		expect(policy.value.run.interactive.budgets.max_tool_calls).toBe(40);
		expect(policy.value.run.unattended.budgets.wall_clock_minutes).toBe(10);
		expect(policy.value.managed?.overridden).toEqual([
			{
				source: "user",
				file: undefined,
				path: "run.interactive.budgets.max_tool_calls",
				managed: 40,
				attempted: 400,
			},
		]);
	});

	test("carries the bundle's budget directives on the policy", async () => {
		const stop: ManagedBudgetDirective = {
			id: "bud_org_month",
			scopeKind: "org",
			scopeId: "org_acme",
			period: "month",
			limitMicroUsd: 500_000_000,
			action: "stop",
		};
		const layer = managed({ version: 1 }, { budgetDirectives: [stop] });
		const policy = await loadPolicy(ports(), ROOT, undefined, layer);
		if (!policy.ok) throw new Error(JSON.stringify(policy.error));
		expect(policy.value.managed?.budgetDirectives).toEqual([stop]);
	});
});

describe("activeBudgetDirectives", () => {
	const directive = (
		period: ManagedBudgetDirective["period"],
	): ManagedBudgetDirective => ({
		id: `bud_${period}`,
		scopeKind: "team",
		scopeId: "team_payments",
		period,
		limitMicroUsd: 1_000_000,
		action: "stop",
	});
	const all = [directive("day"), directive("week"), directive("month")];
	// Monday 2026-09-28.
	const issuedAt = "2026-09-28T08:00:00.000Z";

	test("a directive holds for the rest of the period the bundle was issued in", () => {
		const ids = (now: string) =>
			activeBudgetDirectives(all, issuedAt, new Date(now)).map((d) => d.id);
		expect(ids("2026-09-28T23:59:59.000Z")).toEqual([
			"bud_day",
			"bud_week",
			"bud_month",
		]);
		expect(ids("2026-09-30T12:00:00.000Z")).toEqual(["bud_week", "bud_month"]);
		expect(ids("2026-10-01T00:00:00.000Z")).toEqual(["bud_week"]);
		expect(ids("2026-10-05T00:00:00.000Z")).toEqual([]);
	});

	test("an unparsable issue time keeps every directive (fail closed)", () => {
		expect(
			activeBudgetDirectives(all, "not a time", new Date(issuedAt)).length,
		).toBe(3);
	});
});
