/**
 * Policy pull (#592, spec §6.3 "Policy pull", cloud plan Task 6.3): the
 * device polls `GET /link/v1/policy` with the held bundle's ETag, verifies
 * each new bundle against the org's pinned policy-bundle key and keeps the
 * last good one on disk, where the gate reads it as the managed layer.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { testTmpDir } from "../../__tests__/test-tmp";
import { enrolDevice } from "../enrol";
import { nodeLinkCrypto } from "../keys";
import { verifyBundle } from "../policy-bundle";
import {
	createPolicySync,
	managedLayerReader,
	managedPolicyStatus,
	POLICY_POLL_MS,
	readManagedLayer,
} from "../policy-sync";
import { fileLinkStore } from "../store";
import { trustedOrgKeys } from "../trust";
import { fakeCloud } from "./fake-cloud";

let dir: string;

beforeEach(() => {
	dir = testTmpDir("maina-link-policy-");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-09-28T09:00:00.000Z");
const TIGHT = { version: 1, action_classes: { deploy: { verdict: "deny" } } };
const TIGHTER = {
	version: 1,
	action_classes: {
		deploy: { verdict: "deny" },
		"deps.install": { verdict: "ask" },
	},
};

async function setup() {
	const cloud = fakeCloud();
	const ports = {
		http: cloud.http,
		store: fileLinkStore(join(dir, "link")),
		crypto: nodeLinkCrypto,
		clock: () => new Date(NOW),
	};
	const done = await enrolDevice(
		{ ...ports, sleep: async () => {} },
		{
			baseUrl: cloud.baseUrl,
			device: { os: "linux", arch: "x64", runtimeVersion: "1.8.1" },
		},
	);
	if (!done.ok) throw new Error(JSON.stringify(done.error));
	const trust = {
		orgId: cloud.orgId,
		keys: trustedOrgKeys(done.value, new Date(NOW), "policy-bundle"),
	};
	return { cloud, ports, trust };
}

const at = { crypto: nodeLinkCrypto, now: new Date(NOW) };

function layerOf(ports: Parameters<typeof readManagedLayer>[0]) {
	const read = readManagedLayer(ports);
	if (!read.ok) throw new Error(JSON.stringify(read.error));
	return read.value;
}

describe("verifyBundle", () => {
	test("accepts a bundle signed by the pinned policy-bundle key", async () => {
		const { cloud, trust } = await setup();
		const verified = verifyBundle(
			cloud.policyBundle(3, TIGHT),
			trust,
			null,
			at,
		);
		if (!verified.ok) throw new Error(JSON.stringify(verified.error));
		expect(verified.value.signature).toBe("signed");
		expect(verified.value.layer.version).toBe(3);
		expect(verified.value.layer.value.action_classes?.deploy?.verdict).toBe(
			"deny",
		);
	});

	test("refuses a tampered bundle", async () => {
		const { cloud, trust } = await setup();
		const bundle = cloud.policyBundle(3, TIGHT);
		const tampered = {
			...bundle,
			policy: { version: 1, action_classes: { deploy: { verdict: "ask" } } },
		};
		expect(verifyBundle(tampered, trust, null, at)).toEqual({
			ok: false,
			error: { kind: "bad_signature" },
		});
	});

	test("refuses an unsigned bundle", async () => {
		const { cloud, trust } = await setup();
		const { sig: _sig, ...unsigned } = cloud.policyBundle(3, TIGHT);
		expect(verifyBundle(unsigned, trust, null, at)).toEqual({
			ok: false,
			error: { kind: "unsigned" },
		});
	});

	test("refuses a bundle signed by a key the device does not trust", async () => {
		const { cloud, trust } = await setup();
		cloud.newOrgKey("key_policy_rogue", "policy-bundle");
		const bundle = cloud.policyBundle(3, TIGHT, { keyId: "key_policy_rogue" });
		expect(verifyBundle(bundle, trust, null, at)).toEqual({
			ok: false,
			error: { kind: "untrusted_key", keyId: "key_policy_rogue" },
		});
		// A key of another purpose does not sign bundles either.
		const control = cloud.policyBundle(3, TIGHT, { keyId: "key_control_1" });
		expect(verifyBundle(control, trust, null, at)).toEqual({
			ok: false,
			error: { kind: "untrusted_key", keyId: "key_control_1" },
		});
	});

	test("refuses a downgrade", async () => {
		const { cloud, trust } = await setup();
		const held = { version: 5, etag: `sha256:${"b".repeat(64)}` };
		const older = cloud.policyBundle(4, TIGHT);
		expect(verifyBundle(older, trust, held, at)).toEqual({
			ok: false,
			error: { kind: "downgrade", version: 4, held: 5 },
		});
		// The same version with other content is not an upgrade either.
		const same = cloud.policyBundle(5, TIGHT);
		expect(verifyBundle(same, trust, held, at).ok).toBe(false);
	});

	test("refuses a bundle for another org", async () => {
		const { cloud, trust } = await setup();
		const bundle = cloud.policyBundle(3, TIGHT, { orgId: "org_other" });
		expect(verifyBundle(bundle, trust, null, at)).toEqual({
			ok: false,
			error: { kind: "wrong_org", orgId: "org_other" },
		});
	});

	test("refuses a bundle that is not valid yet", async () => {
		const { cloud, trust } = await setup();
		const bundle = cloud.policyBundle(3, TIGHT, {
			notBefore: "2026-09-29T00:00:00.000Z",
		});
		expect(verifyBundle(bundle, trust, null, at)).toEqual({
			ok: false,
			error: { kind: "not_yet_valid", notBefore: "2026-09-29T00:00:00.000Z" },
		});
	});

	test("refuses a signed bundle whose policy does not validate", async () => {
		const { cloud, trust } = await setup();
		const bundle = cloud.policyBundle(3, {
			version: 1,
			action_classes: { deploy: { verdict: "maybe" } },
		});
		const verified = verifyBundle(bundle, trust, null, at);
		expect(verified.ok).toBe(false);
		if (verified.ok) return;
		expect(verified.error.kind).toBe("invalid_policy");
	});

	describe("while the cloud's signer is dark (adr/0012 §6)", () => {
		test("refuses a bundle marked unsigned: no pinned key verifies it", async () => {
			const { cloud, trust } = await setup();
			const dark = cloud.policyBundle(3, TIGHT, { signed: false });
			expect(verifyBundle(dark, trust, null, at)).toEqual({
				ok: false,
				error: { kind: "unsigned" },
			});
		});

		test("refuses one whatever bundle is held", async () => {
			const { cloud, trust } = await setup();
			const dark = cloud.policyBundle(9, TIGHT, { signed: false });
			const held = { version: 3, etag: `sha256:${"b".repeat(64)}` };
			expect(verifyBundle(dark, trust, held, at)).toEqual({
				ok: false,
				error: { kind: "unsigned" },
			});
		});

		test("a zero signature under a real key id is just a bad signature", async () => {
			const { cloud, trust } = await setup();
			const forged = {
				...cloud.policyBundle(3, TIGHT),
				sig: "A".repeat(86),
			};
			expect(verifyBundle(forged, trust, null, at)).toEqual({
				ok: false,
				error: { kind: "bad_signature" },
			});
		});
	});
});

describe("createPolicySync", () => {
	test("a device that was never enrolled pulls nothing and has no managed layer", async () => {
		const cloud = fakeCloud();
		const ports = {
			http: cloud.http,
			store: fileLinkStore(join(dir, "link")),
			crypto: nodeLinkCrypto,
			clock: () => new Date(NOW),
		};
		const sync = createPolicySync(ports);
		expect(await sync.tick()).toBe(POLICY_POLL_MS);
		expect(cloud.requests).toEqual([]);
		expect(readManagedLayer(ports)).toEqual({ ok: true, value: undefined });
		expect(managedPolicyStatus(ports)).toEqual({ kind: "not_enrolled" });
	});

	test("polls well inside the 5-minute propagation goal", () => {
		expect(POLICY_POLL_MS).toBeLessThanOrEqual(5 * 60_000);
	});

	test("keeps a verified bundle as the managed layer", async () => {
		const { cloud, ports } = await setup();
		cloud.state.policy = cloud.policyBundle(3, TIGHT);
		await createPolicySync(ports).tick();
		const layer = layerOf(ports);
		expect(layer?.version).toBe(3);
		expect(layer?.signature).toBe("signed");
		expect(layer?.value.action_classes?.deploy?.verdict).toBe("deny");
		expect(managedPolicyStatus(ports)).toMatchObject({
			kind: "held",
			version: 3,
			signature: "signed",
			keyId: "key_policy_1",
			lastRefusal: null,
		});
	});

	test("always sends the held bundle's ETag, and a 304 keeps it", async () => {
		const { cloud, ports } = await setup();
		const bundle = cloud.policyBundle(3, TIGHT);
		cloud.state.policy = bundle;
		const sync = createPolicySync(ports);
		await sync.tick();
		await sync.tick();
		const hex = String(bundle.etag).replace("sha256:", "");
		expect(cloud.state.policyPulls).toEqual([undefined, `"3.${hex}"`]);
		expect(layerOf(ports)?.version).toBe(3);
		// A fresh process (a restarted runtime) sends it too.
		await createPolicySync(ports).tick();
		expect(cloud.state.policyPulls.at(-1)).toBe(`"3.${hex}"`);
	});

	test("a new version is applied within one poll interval", async () => {
		const { cloud, ports } = await setup();
		cloud.state.policy = cloud.policyBundle(3, TIGHT);
		const sync = createPolicySync(ports);
		const wait = await sync.tick();
		cloud.state.policy = cloud.policyBundle(4, TIGHTER);
		expect(wait).toBe(POLICY_POLL_MS);
		await sync.tick();
		const layer = layerOf(ports);
		expect(layer?.version).toBe(4);
		expect(layer?.value.action_classes?.["deps.install"]?.verdict).toBe("ask");
	});

	test.each([
		["tampered", "bad_signature"],
		["unsigned", "unsigned"],
		["downgraded", "downgrade"],
		["wrong-org", "wrong_org"],
	] as const)("a %s bundle is refused and the last good bundle stays in force", async (how, kind) => {
		const { cloud, ports } = await setup();
		cloud.state.policy = cloud.policyBundle(3, TIGHT);
		const sync = createPolicySync(ports);
		await sync.tick();

		const next = cloud.policyBundle(4, { version: 1 });
		const { sig: _sig, ...withoutSig } = next;
		cloud.state.policy =
			how === "tampered"
				? { ...next, policy: { version: 1, action_classes: {} } }
				: how === "unsigned"
					? withoutSig
					: how === "downgraded"
						? cloud.policyBundle(2, { version: 1 })
						: cloud.policyBundle(4, { version: 1 }, { orgId: "org_other" });
		await sync.tick();

		expect(sync.status().lastError).toMatchObject({ kind });
		const layer = layerOf(ports);
		expect(layer?.version).toBe(3);
		expect(layer?.value.action_classes?.deploy?.verdict).toBe("deny");
		expect(managedPolicyStatus(ports)).toMatchObject({
			kind: "held",
			version: 3,
			lastRefusal: { kind },
		});
	});

	test("a bundle from the dark signer is refused and nothing is held", async () => {
		const { cloud, ports } = await setup();
		cloud.state.policy = cloud.policyBundle(3, TIGHT, { signed: false });
		const sync = createPolicySync(ports);
		await sync.tick();
		expect(sync.status().lastError).toMatchObject({ kind: "unsigned" });
		expect(layerOf(ports)).toBeUndefined();
		expect(managedPolicyStatus(ports)).toMatchObject({
			kind: "none",
			lastRefusal: { kind: "unsigned", version: 3 },
		});
	});

	test("a bundle from the dark signer never replaces the last good one", async () => {
		const { cloud, ports } = await setup();
		cloud.state.policy = cloud.policyBundle(3, TIGHT);
		const sync = createPolicySync(ports);
		await sync.tick();
		cloud.state.policy = cloud.policyBundle(
			4,
			{ version: 1 },
			{ signed: false },
		);
		await sync.tick();
		expect(sync.status().lastError).toMatchObject({ kind: "unsigned" });
		const layer = layerOf(ports);
		expect(layer?.version).toBe(3);
		expect(layer?.signature).toBe("signed");
	});

	test("with the cloud down the last good policy applies, read without the network", async () => {
		const { cloud, ports } = await setup();
		cloud.state.policy = cloud.policyBundle(3, TIGHT);
		const sync = createPolicySync(ports);
		await sync.tick();
		cloud.state.offline = true;
		expect(await sync.tick()).toBe(POLICY_POLL_MS);
		expect(sync.status().lastError).toMatchObject({ kind: "network" });
		const requests = cloud.requests.length;
		expect(layerOf(ports)?.version).toBe(3);
		// Reading the managed layer never touches the network.
		expect(cloud.requests.length).toBe(requests);
	});

	test("the gate's reader verifies a held bundle once, then only reads the file", async () => {
		const { cloud, ports } = await setup();
		cloud.state.policy = cloud.policyBundle(3, TIGHT);
		const sync = createPolicySync(ports);
		await sync.tick();
		cloud.state.offline = true;
		let verifies = 0;
		const counting = {
			...ports,
			crypto: {
				...nodeLinkCrypto,
				verify: (...args: Parameters<typeof nodeLinkCrypto.verify>) => {
					verifies++;
					return nodeLinkCrypto.verify(...args);
				},
			},
		};
		const read = managedLayerReader(counting);
		const requests = cloud.requests.length;
		const started = performance.now();
		for (let i = 0; i < 200; i++) {
			const layer = read();
			expect(layer.ok && layer.value?.version).toBe(3);
		}
		const perRead = (performance.now() - started) / 200;
		expect(verifies).toBe(1);
		expect(cloud.requests.length).toBe(requests);
		// A disk read, well under a millisecond (a loose bound for loaded CI).
		expect(perRead).toBeLessThan(1);

		// A new bundle on disk is picked up at the next read.
		cloud.state.offline = false;
		cloud.state.policy = cloud.policyBundle(4, TIGHTER);
		await sync.tick();
		expect(read().ok && read()).toMatchObject({ value: { version: 4 } });
		expect(verifies).toBe(2);
	});

	test("no published policy leaves the device without a managed layer", async () => {
		const { ports } = await setup();
		const sync = createPolicySync(ports);
		await sync.tick();
		expect(sync.status().lastError).toBeNull();
		expect(layerOf(ports)).toBeUndefined();
		expect(managedPolicyStatus(ports)).toEqual({
			kind: "none",
			lastRefusal: null,
		});
	});

	test("a held bundle edited on disk is refused on read (the gate then asks)", async () => {
		const { cloud, ports } = await setup();
		cloud.state.policy = cloud.policyBundle(3, TIGHT);
		await createPolicySync(ports).tick();
		const file = join(dir, "link", "policy", "bundle.json");
		const held = JSON.parse(readFileSync(file, "utf-8"));
		held.held.bundle.policy = { version: 1 };
		writeFileSync(file, JSON.stringify(held));
		const read = readManagedLayer(ports);
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.error[0]?.source).toBe("managed");
	});

	test("a dark bundle written over the held file is refused on read", async () => {
		const { cloud, ports } = await setup();
		cloud.state.policy = cloud.policyBundle(3, TIGHT);
		await createPolicySync(ports).tick();
		const file = join(dir, "link", "policy", "bundle.json");
		const held = JSON.parse(readFileSync(file, "utf-8"));
		held.held.bundle = cloud.policyBundle(
			99,
			{ version: 1 },
			{ signed: false },
		);
		held.held.signature = "unsigned";
		writeFileSync(file, JSON.stringify(held));
		const read = readManagedLayer(ports);
		expect(read.ok).toBe(false);
		if (read.ok) return;
		expect(read.error[0]?.message).toContain("(unsigned)");
	});

	test("a held file that no longer verifies does not block the next good bundle as a downgrade", async () => {
		const { cloud, ports } = await setup();
		cloud.state.policy = cloud.policyBundle(3, TIGHT);
		const sync = createPolicySync(ports);
		await sync.tick();
		const file = join(dir, "link", "policy", "bundle.json");
		const held = JSON.parse(readFileSync(file, "utf-8"));
		held.held.bundle.version = 99;
		writeFileSync(file, JSON.stringify(held));
		expect(readManagedLayer(ports).ok).toBe(false);
		cloud.state.policy = cloud.policyBundle(4, TIGHTER);
		await sync.tick();
		expect(sync.status().lastError).toBeNull();
		expect(layerOf(ports)?.version).toBe(4);
	});

	test("logging out removes the managed layer (back to v1)", async () => {
		const { cloud, ports } = await setup();
		cloud.state.policy = cloud.policyBundle(3, TIGHT);
		await createPolicySync(ports).tick();
		expect(ports.store.clear().ok).toBe(true);
		expect(readManagedLayer(ports)).toEqual({ ok: true, value: undefined });
	});

	test("only the budget directives of the current period reach the layer", async () => {
		const { cloud, ports } = await setup();
		const directive = {
			id: "bud_day",
			scopeKind: "org",
			scopeId: cloud.orgId,
			period: "day",
			limitMicroUsd: 1_000_000,
			action: "stop",
		} as const;
		cloud.state.policy = cloud.policyBundle(3, TIGHT, {
			budgetDirectives: [directive],
		});
		await createPolicySync(ports).tick();
		expect(layerOf(ports)?.budgetDirectives).toEqual([directive]);
		const tomorrow = { ...ports, clock: () => new Date(NOW + 86_400_000) };
		expect(layerOf(tomorrow)?.budgetDirectives).toEqual([]);
	});
});
