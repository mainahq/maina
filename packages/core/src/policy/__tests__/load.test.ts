import { describe, expect, test } from "bun:test";
import { createMemoryFs } from "../../ports/testing";
import { DEFAULT_POLICY, IRREVERSIBLE_ACTION_CLASSES } from "../defaults";
import { loadPolicy } from "../load";

const ROOT = "/repo";
const POLICY_PATH = "/repo/.maina/policy.json";

function portsWith(files: Readonly<Record<string, string>> = {}) {
	return { fs: createMemoryFs(files) };
}

function repoPolicy(policy: unknown) {
	return portsWith({ [POLICY_PATH]: JSON.stringify(policy) });
}

describe("default policy", () => {
	test("marks exactly the FR-GATE-4 set irreversible, and asks on them", () => {
		const irreversible = Object.entries(DEFAULT_POLICY.action_classes)
			.filter(([, spec]) => spec.irreversible)
			.map(([id]) => id)
			.sort();
		expect(irreversible).toEqual([...IRREVERSIBLE_ACTION_CLASSES].sort());
		for (const id of IRREVERSIBLE_ACTION_CLASSES) {
			expect(DEFAULT_POLICY.action_classes[id]?.verdict).toBe("ask");
		}
	});

	test("covers every FR-GATE-4 category with an irreversible class", () => {
		// Spec FR-GATE-4, verbatim categories → the classes that carry them.
		const FR_GATE_4: Readonly<Record<string, readonly string[]>> = {
			"deleting outside the workspace": ["fs.delete.outside"],
			"force-pushing": ["git.push.force"],
			"production data": ["db.production"],
			deploys: ["deploy"],
			"credential access": ["secrets.read", "secrets.write"],
			"package publishing": ["package.publish"],
		};
		for (const ids of Object.values(FR_GATE_4)) {
			for (const id of ids) {
				expect(DEFAULT_POLICY.action_classes[id]).toEqual({
					irreversible: true,
					verdict: "ask",
				});
			}
		}
	});

	test("opts into no telemetry by default", () => {
		expect(Object.values(DEFAULT_POLICY.telemetry)).toEqual(
			Object.values(DEFAULT_POLICY.telemetry).map(() => false),
		);
	});

	test("loads as the defaults when neither user nor repo policy exists", async () => {
		expect(await loadPolicy(portsWith(), ROOT, undefined)).toEqual({
			ok: true,
			value: DEFAULT_POLICY,
		});
	});
});

describe("merge order: defaults < user < repo", () => {
	test("user overrides defaults and repo overrides user, key by key", async () => {
		const result = await loadPolicy(
			repoPolicy({
				decisions: { "action.risk": { thresholds: { confidence: 0.95 } } },
				drift: { window: 50 },
			}),
			ROOT,
			{
				decisions: {
					"action.risk": {
						backend: "rules",
						thresholds: { confidence: 0.7 },
					},
				},
				drift: { window: 10, max_error_rate: 0.2 },
			},
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const risk = result.value.decisions["action.risk"];
		expect(risk?.backend).toBe("rules");
		expect(risk?.thresholds.confidence).toBe(0.95);
		expect(risk?.error_costs).toEqual(
			DEFAULT_POLICY.decisions["action.risk"]?.error_costs,
		);
		expect(result.value.drift).toEqual({
			...DEFAULT_POLICY.drift,
			window: 50,
			max_error_rate: 0.2,
		});
	});

	test("rule lists accumulate, so a repo cannot drop a user's deny rule", async () => {
		const result = await loadPolicy(
			repoPolicy({
				rules: {
					allow: [{ match: "bun test", kind: "shell" }],
					deny: [{ match: "~/.aws/**", kind: "file.read.outside" }],
				},
			}),
			ROOT,
			{ rules: { deny: [{ match: "rm -rf /", kind: "shell" }] } },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.rules.deny.map((r) => r.match)).toEqual([
			"rm -rf /",
			"~/.aws/**",
		]);
		expect(result.value.rules.allow.map((r) => r.match)).toEqual(["bun test"]);
	});
});

describe("irreversible action classes", () => {
	test("repo policy can tighten an irreversible class", async () => {
		const result = await loadPolicy(
			repoPolicy({
				action_classes: { "package.publish": { verdict: "deny" } },
			}),
			ROOT,
			undefined,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.action_classes["package.publish"]).toEqual({
			irreversible: true,
			verdict: "deny",
		});
	});

	test("repo policy can tighten a user default", async () => {
		const result = await loadPolicy(
			repoPolicy({ action_classes: { "git.push": { verdict: "ask" } } }),
			ROOT,
			{ action_classes: { "git.push": { verdict: "allow" } } },
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.action_classes["git.push"]?.verdict).toBe("ask");
	});

	test("repo policy cannot loosen an irreversible class to allow", async () => {
		const result = await loadPolicy(
			repoPolicy({
				action_classes: { "package.publish": { verdict: "allow" } },
			}),
			ROOT,
			undefined,
		);
		expect(result).toEqual({
			ok: false,
			error: [
				expect.objectContaining({
					kind: "loosening",
					source: "repo",
					file: POLICY_PATH,
					path: "action_classes.package.publish.verdict",
					actionClass: "package.publish",
				}),
			],
		});
	});

	test("repo policy cannot loosen a class the user tightened to deny", async () => {
		const result = await loadPolicy(
			repoPolicy({ action_classes: { "db.destructive": { verdict: "ask" } } }),
			ROOT,
			{ action_classes: { "db.destructive": { verdict: "deny" } } },
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.map((e) => e.path)).toEqual([
			"action_classes.db.destructive.verdict",
		]);
	});

	test("repo policy cannot mark an irreversible class reversible", async () => {
		const result = await loadPolicy(
			repoPolicy({
				action_classes: { "git.push.force": { irreversible: false } },
			}),
			ROOT,
			undefined,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toEqual([
			expect.objectContaining({
				kind: "loosening",
				path: "action_classes.git.push.force.irreversible",
			}),
		]);
	});

	test("explicitly_allow lets a layer loosen a named class, and the loosening is recorded", async () => {
		const result = await loadPolicy(
			repoPolicy({
				explicitly_allow: ["package.publish"],
				action_classes: { "package.publish": { verdict: "allow" } },
			}),
			ROOT,
			undefined,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.action_classes["package.publish"]?.verdict).toBe(
			"allow",
		);
		expect(result.value.loosened).toEqual([
			{ actionClass: "package.publish", source: "repo", before: "ask" },
		]);
	});

	test("explicitly_allow for one class does not unlock another", async () => {
		const result = await loadPolicy(
			repoPolicy({
				explicitly_allow: ["package.publish"],
				action_classes: { "remote.exec": { verdict: "allow" } },
			}),
			ROOT,
			undefined,
		);
		expect(result.ok).toBe(false);
	});

	test("a class a layer introduces without a verdict fails closed to ask", async () => {
		const result = await loadPolicy(
			repoPolicy({
				action_classes: {
					"k8s.apply": { irreversible: true },
					"lint.run": { irreversible: false },
				},
			}),
			ROOT,
			undefined,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.action_classes["k8s.apply"]).toEqual({
			irreversible: true,
			verdict: "ask",
		});
		expect(result.value.action_classes["lint.run"]?.verdict).toBe("ask");
	});

	test("a new irreversible class cannot be introduced as allow without explicitly_allow", async () => {
		const denied = await loadPolicy(
			repoPolicy({
				action_classes: {
					"k8s.apply": { irreversible: true, verdict: "allow" },
				},
			}),
			ROOT,
			undefined,
		);
		expect(denied.ok).toBe(false);
		if (denied.ok) return;
		expect(denied.error.map((e) => e.path)).toEqual([
			"action_classes.k8s.apply.verdict",
		]);

		const unlocked = await loadPolicy(
			repoPolicy({
				explicitly_allow: ["k8s.apply"],
				action_classes: {
					"k8s.apply": { irreversible: true, verdict: "allow" },
				},
			}),
			ROOT,
			undefined,
		);
		expect(unlocked.ok).toBe(true);
		if (!unlocked.ok) return;
		expect(unlocked.value.loosened).toEqual([
			{ actionClass: "k8s.apply", source: "repo", before: "ask" },
		]);
	});

	test("the user layer is held to the same rule", async () => {
		const result = await loadPolicy(portsWith(), ROOT, {
			action_classes: { "fs.delete.recursive": { verdict: "allow" } },
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error[0]).toEqual(
			expect.objectContaining({ kind: "loosening", source: "user" }),
		);
	});
});

describe("telemetry opt-ins", () => {
	test("only the user can opt in; a repo policy can only opt out", async () => {
		const denied = await loadPolicy(
			repoPolicy({ telemetry: { outcome_sharing: true } }),
			ROOT,
			undefined,
		);
		expect(denied.ok).toBe(false);
		if (denied.ok) return;
		expect(denied.error.map((e) => e.path)).toEqual([
			"telemetry.outcome_sharing",
		]);

		const optedOut = await loadPolicy(
			repoPolicy({ telemetry: { usage: false } }),
			ROOT,
			{ telemetry: { usage: true, crash_reports: true } },
		);
		expect(optedOut.ok).toBe(true);
		if (!optedOut.ok) return;
		expect(optedOut.value.telemetry.usage).toBe(false);
		expect(optedOut.value.telemetry.crash_reports).toBe(true);
	});
});

describe("validation", () => {
	test("returns every error from every layer with its source and path", async () => {
		const result = await loadPolicy(
			repoPolicy({
				action_classes: { "Not A Class": { verdict: "maybe" } },
				decisions: { "action.risk": { thresholds: { confidence: 2 } } },
				drift: { window: 0 },
			}),
			ROOT,
			{ rules: { deny: [{ match: "" }] } },
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const found = result.error.map((e) => `${e.source}:${e.path}`).sort();
		expect(found).toEqual([
			"repo:action_classes.Not A Class",
			"repo:decisions.action.risk.thresholds.confidence",
			"repo:drift.window",
			"user:rules.deny[0].match",
		]);
	});

	test("rejects unknown decision types", async () => {
		const result = await loadPolicy(
			repoPolicy({ decisions: { "action.rsik": { backend: "rules" } } }),
			ROOT,
			undefined,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error[0]?.path).toBe("decisions.action.rsik");
	});

	test("reports malformed repo JSON as a parse error", async () => {
		const result = await loadPolicy(
			portsWith({ [POLICY_PATH]: "[" }),
			ROOT,
			undefined,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toEqual([
			expect.objectContaining({
				kind: "parse",
				source: "repo",
				file: POLICY_PATH,
			}),
		]);
	});
});
