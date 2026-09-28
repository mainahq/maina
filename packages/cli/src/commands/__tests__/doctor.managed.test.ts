/**
 * `maina doctor` and the managed policy layer (#592): the version and
 * signature state of the bundle the device holds, and every user or repo
 * setting that tries to loosen a managed rule (the managed rule wins).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeCloud } from "@mainahq/runtime/src/link/__tests__/fake-cloud";
import { enrolDevice } from "@mainahq/runtime/src/link/enrol";
import { nodeLinkCrypto } from "@mainahq/runtime/src/link/keys";
import { createPolicySync } from "@mainahq/runtime/src/link/policy-sync";
import { fileLinkStore } from "@mainahq/runtime/src/link/store";
import { checkManagedPolicy } from "../doctor";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "maina-doctor-managed-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-09-28T09:00:00.000Z");
const clock = () => new Date(NOW);

async function enrolled() {
	const cloud = fakeCloud();
	const ports = {
		http: cloud.http,
		store: fileLinkStore(join(dir, "link")),
		crypto: nodeLinkCrypto,
		clock,
	};
	const done = await enrolDevice(
		{ ...ports, sleep: async () => {} },
		{
			baseUrl: cloud.baseUrl,
			device: { os: "linux", arch: "x64", runtimeVersion: "1.8.1" },
		},
	);
	if (!done.ok) throw new Error(JSON.stringify(done.error));
	return { cloud, ports };
}

function check() {
	const repo = join(dir, "repo");
	mkdirSync(repo, { recursive: true });
	return checkManagedPolicy({
		root: repo,
		home: join(dir, "home"),
		linkDir: join(dir, "link"),
		clock,
	});
}

function writeUserPolicy(policy: unknown): void {
	const file = join(dir, "home", ".maina", "policy.json");
	mkdirSync(join(dir, "home", ".maina"), { recursive: true });
	writeFileSync(file, JSON.stringify(policy));
}

describe("checkManagedPolicy", () => {
	test("a machine that was never enrolled has no managed policy and no warning", async () => {
		const report = await check();
		expect(report).toMatchObject({
			status: "not_enrolled",
			version: null,
			warnings: [],
			overridden: [],
		});
	});

	test("reports the version and signature of the held bundle", async () => {
		const { cloud, ports } = await enrolled();
		cloud.state.policy = cloud.policyBundle(5, {
			version: 1,
			action_classes: { "deps.install": { verdict: "ask" } },
		});
		await createPolicySync(ports).tick();
		const report = await check();
		expect(report).toMatchObject({
			status: "signed",
			version: 5,
			keyId: "key_policy_1",
			warnings: [],
		});
	});

	test("warns that an unsigned managed policy is unsigned", async () => {
		const { cloud, ports } = await enrolled();
		cloud.state.policy = cloud.policyBundle(
			5,
			{ version: 1, action_classes: { deploy: { verdict: "deny" } } },
			{ signed: false },
		);
		await createPolicySync(ports).tick();
		const report = await check();
		expect(report.status).toBe("unsigned");
		expect(report.warnings.join("\n")).toContain("UNSIGNED managed policy");
	});

	test("a user layer that loosens a managed rule is reported, and the managed rule wins", async () => {
		const { cloud, ports } = await enrolled();
		cloud.state.policy = cloud.policyBundle(5, {
			version: 1,
			action_classes: { "deps.install": { verdict: "ask" } },
		});
		await createPolicySync(ports).tick();
		writeUserPolicy({
			action_classes: { "deps.install": { verdict: "allow" } },
		});
		const report = await check();
		expect(report.overridden).toEqual([
			{
				source: "user",
				file: undefined,
				path: "action_classes.deps.install.verdict",
				managed: "ask",
				attempted: "allow",
			},
		]);
		expect(report.warnings.join("\n")).toContain(
			"user policy action_classes.deps.install.verdict: allow loosens the managed ask; the managed rule wins",
		);
	});

	test("reports a bundle the device refused, and an active budget directive", async () => {
		const { cloud, ports } = await enrolled();
		cloud.state.policy = cloud.policyBundle(
			5,
			{ version: 1 },
			{
				budgetDirectives: [
					{
						id: "bud_org_month",
						scopeKind: "org",
						scopeId: cloud.orgId,
						period: "month",
						limitMicroUsd: 250_000_000,
						action: "stop",
					},
				],
			},
		);
		const sync = createPolicySync(ports);
		await sync.tick();
		cloud.state.policy = cloud.policyBundle(4, { version: 1 });
		await sync.tick();
		const warnings = (await check()).warnings.join("\n");
		expect(warnings).toContain("refused");
		expect(warnings).toContain("downgrade");
		expect(warnings).toContain("bud_org_month");
		expect(warnings).toContain("stop");
	});
});
