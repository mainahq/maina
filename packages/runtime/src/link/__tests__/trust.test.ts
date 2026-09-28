/**
 * Trusted org keys (#589): pinned at enrolment, changed only by a
 * `key_rotation` control message signed by a link-control key the device
 * already trusts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrolDevice } from "../enrol";
import { nodeLinkCrypto } from "../keys";
import { type DeviceState, fileLinkStore } from "../store";
import {
	acceptControlMessage,
	type ControlRefusal,
	trustedOrgKeys,
} from "../trust";
import { type FakeCloud, fakeCloud } from "./fake-cloud";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "maina-link-trust-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-09-28T09:00:00.000Z");

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
	return { cloud, ports, device: done.value };
}

function rotation(
	cloud: FakeCloud,
	body: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		v: 1,
		orgId: cloud.orgId,
		messageId: "ctl_rot_1",
		deviceId: "dev_01J9Z3K4T8QX",
		kind: "key_rotation",
		issuedAt: "2026-09-28T08:59:00.000Z",
		expiresAt: "2026-09-28T09:05:00.000Z",
		body,
		...overrides,
	};
}

const state = (store: ReturnType<typeof fileLinkStore>): DeviceState => {
	const read = store.readState();
	if (!read.ok || read.value === null) throw new Error("no state");
	return read.value;
};

describe("trustedOrgKeys", () => {
	test("returns the keys pinned at enrolment, by purpose", async () => {
		const { device } = await setup();
		const all = trustedOrgKeys(device, new Date(NOW));
		expect(all.map((k) => k.keyId).sort()).toEqual([
			"key_approval_1",
			"key_control_1",
			"key_policy_1",
		]);
		expect(
			trustedOrgKeys(device, new Date(NOW), "link-control").map((k) => k.keyId),
		).toEqual(["key_control_1"]);
	});

	test("a key outside its validity window is not trusted", async () => {
		const { device } = await setup();
		const keys = device.enrolment.orgKeys.map((k) =>
			k.keyId === "key_policy_1"
				? { ...k, notAfter: "2026-09-01T00:00:00.000Z" }
				: k.keyId === "key_approval_1"
					? { ...k, notBefore: "2027-01-01T00:00:00.000Z" }
					: k,
		);
		const edited = {
			...device,
			enrolment: { ...device.enrolment, orgKeys: keys },
		};
		expect(trustedOrgKeys(edited, new Date(NOW)).map((k) => k.keyId)).toEqual([
			"key_control_1",
		]);
	});
});

describe("acceptControlMessage key_rotation", () => {
	test("a rotation signed by the trusted link-control key adds and retires keys", async () => {
		const { cloud, ports } = await setup();
		const next = cloud.newOrgKey("key_policy_2", "policy-bundle");
		const message = cloud.signControl(
			rotation(cloud, { add: [next.entry], retire: ["key_policy_1"] }),
		);
		const accepted = await acceptControlMessage(ports, message);
		expect(accepted.ok).toBe(true);
		const keys = trustedOrgKeys(state(ports.store), new Date(NOW));
		expect(keys.map((k) => k.keyId).sort()).toEqual([
			"key_approval_1",
			"key_control_1",
			"key_policy_2",
		]);
	});

	test("the new link-control key then verifies the next rotation", async () => {
		const { cloud, ports } = await setup();
		const control2 = cloud.newOrgKey("key_control_2", "link-control");
		const first = cloud.signControl(
			rotation(cloud, { add: [control2.entry], retire: ["key_control_1"] }),
		);
		expect((await acceptControlMessage(ports, first)).ok).toBe(true);
		const policy2 = cloud.newOrgKey("key_policy_2", "policy-bundle");
		const second = cloud.signControl(
			rotation(
				cloud,
				{ add: [policy2.entry], retire: [] },
				{ messageId: "ctl_rot_2", issuedAt: "2026-09-28T08:59:30.000Z" },
			),
			"key_control_2",
		);
		expect((await acceptControlMessage(ports, second)).ok).toBe(true);
		// The retired key signs nothing any more.
		const stale = cloud.signControl(
			rotation(
				cloud,
				{ add: [], retire: ["key_policy_2"] },
				{ messageId: "ctl_rot_3", issuedAt: "2026-09-28T08:59:40.000Z" },
			),
			"key_control_1",
		);
		const refused = await acceptControlMessage(ports, stale);
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.error.kind).toBe("untrusted_key");
	});

	const refusals: [
		string,
		(cloud: FakeCloud) => unknown,
		ControlRefusal["kind"],
	][] = [
		[
			"an unsigned message",
			(cloud) => ({
				...rotation(cloud, { add: [], retire: [] }),
				keyId: "key_control_1",
				sig: "A".repeat(86),
			}),
			"bad_signature",
		],
		[
			"a message signed by a key the device never trusted",
			(cloud) => {
				const rogue = generateKeyPairSync("ed25519").privateKey;
				return cloud.signWith(rogue, {
					...rotation(cloud, { add: [], retire: ["key_policy_1"] }),
					keyId: "key_control_1",
				});
			},
			"bad_signature",
		],
		[
			"a message signed by a policy key, not a link-control key",
			(cloud) =>
				cloud.signControl(
					rotation(cloud, { add: [], retire: ["key_approval_1"] }),
					"key_policy_1",
				),
			"untrusted_key",
		],
		[
			"a message for another device",
			(cloud) =>
				cloud.signControl(
					rotation(cloud, { add: [], retire: [] }, { deviceId: "dev_other" }),
				),
			"wrong_device",
		],
		[
			"an expired message",
			(cloud) =>
				cloud.signControl(
					rotation(
						cloud,
						{ add: [], retire: [] },
						{ expiresAt: "2026-09-28T08:59:59.000Z" },
					),
				),
			"expired",
		],
		[
			"a rotation that would leave no link-control key",
			(cloud) =>
				cloud.signControl(
					rotation(cloud, { add: [], retire: ["key_control_1"] }),
				),
			"would_lock_out",
		],
		[
			"a message that is not the published shape",
			(cloud) => cloud.signControl({ v: 1, kind: "key_rotation" }),
			"invalid_message",
		],
	];

	for (const [name, build, kind] of refusals) {
		test(`refuses ${name} and keeps the pinned keys`, async () => {
			const { cloud, ports, device } = await setup();
			const refused = await acceptControlMessage(ports, build(cloud));
			expect(refused.ok).toBe(false);
			if (!refused.ok) expect(refused.error.kind).toBe(kind);
			expect(state(ports.store).enrolment.orgKeys).toEqual(
				device.enrolment.orgKeys,
			);
		});
	}

	test("a replayed rotation is refused", async () => {
		const { cloud, ports } = await setup();
		const next = cloud.newOrgKey("key_policy_2", "policy-bundle");
		const message = cloud.signControl(
			rotation(cloud, { add: [next.entry], retire: [] }),
		);
		expect((await acceptControlMessage(ports, message)).ok).toBe(true);
		const replay = await acceptControlMessage(ports, message);
		expect(replay.ok).toBe(false);
		if (!replay.ok) expect(replay.error.kind).toBe("replayed");
	});

	test("a verified stop message is returned for the caller, keys unchanged", async () => {
		const { cloud, ports, device } = await setup();
		const stop = cloud.signControl({
			v: 1,
			orgId: cloud.orgId,
			messageId: "ctl_stop_1",
			deviceId: "dev_01J9Z3K4T8QX",
			kind: "stop",
			issuedAt: "2026-09-28T08:59:00.000Z",
			expiresAt: "2026-09-28T09:05:00.000Z",
			body: { runId: "run_1", reason: "stopped_from_board" },
		});
		const accepted = await acceptControlMessage(ports, stop);
		expect(accepted.ok).toBe(true);
		if (accepted.ok) expect(accepted.value.kind).toBe("stop");
		expect(state(ports.store).enrolment.orgKeys).toEqual(
			device.enrolment.orgKeys,
		);
	});
});
