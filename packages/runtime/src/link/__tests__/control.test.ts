/**
 * Remote control over Link (#594, cloud plan Task 8.4, FR-RUN-3): the run
 * board's `stop` and `revision_grant` control messages reach the run they
 * name only when they verify under the org's pinned link-control key. An
 * unsigned (dark) or unverified message is ignored, and every message this
 * device acts on or ignores is audited locally.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { testTmpDir } from "../../__tests__/test-tmp";
import {
	type ControlAuditEntry,
	createRemoteControl,
	type RunControlHandle,
} from "../control";
import { enrolDevice } from "../enrol";
import { nodeLinkCrypto } from "../keys";
import { fileLinkStore } from "../store";
import { type FakeCloud, fakeCloud } from "./fake-cloud";

let dir: string;

beforeEach(() => {
	dir = testTmpDir("maina-link-control-");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-09-28T09:00:00.000Z");
const RUN_ID = "run-m1abc-1f2e3d4c";
const DEVICE_ID = "dev_01J9Z3K4T8QX";

async function setup(options: Readonly<{ enrol?: boolean }> = {}) {
	const cloud = fakeCloud();
	const audit: ControlAuditEntry[] = [];
	const ports = {
		http: cloud.http,
		store: fileLinkStore(join(dir, "link")),
		crypto: nodeLinkCrypto,
		clock: () => new Date(NOW),
		audit: (entry: ControlAuditEntry) => {
			audit.push(entry);
		},
	};
	if (options.enrol !== false) {
		const done = await enrolDevice(
			{ ...ports, sleep: async () => {} },
			{
				baseUrl: cloud.baseUrl,
				device: { os: "linux", arch: "x64", runtimeVersion: "1.8.1" },
			},
		);
		if (!done.ok) throw new Error(JSON.stringify(done.error));
	}
	return { cloud, ports, audit, control: createRemoteControl(ports) };
}

function message(
	cloud: FakeCloud,
	kind: "stop" | "revision_grant",
	body: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		v: 1,
		orgId: cloud.orgId,
		messageId: "ctl_1",
		deviceId: DEVICE_ID,
		kind,
		issuedAt: "2026-09-28T08:59:00.000Z",
		expiresAt: "2026-09-28T09:30:00.000Z",
		body,
		...overrides,
	};
}

const stop = (cloud: FakeCloud, overrides: Record<string, unknown> = {}) =>
	cloud.signControl(
		message(
			cloud,
			"stop",
			{ runId: RUN_ID, reason: "stopped_from_board" },
			overrides,
		),
	);

const grant = (cloud: FakeCloud, messageId: string, grantId: string) =>
	cloud.signControl(
		message(cloud, "revision_grant", { runId: RUN_ID, grantId }, { messageId }),
	);

/** The dark signer's mark: `keyId: "unsigned"` and an all-zero signature. */
const dark = (unsigned: Record<string, unknown>) => ({
	...unsigned,
	keyId: "unsigned",
	sig: "A".repeat(86),
});

function recordingHandle(grants = { applied: false }) {
	const stops: (string | undefined)[] = [];
	const granted: string[] = [];
	const handle: RunControlHandle = {
		stop: (reason) => {
			stops.push(reason);
		},
		grantRevision: (grantId) => {
			granted.push(grantId);
			if (grants.applied) return false;
			grants.applied = true;
			return true;
		},
	};
	return { handle, stops, granted };
}

describe("receive: stop", () => {
	test("a signed stop reaches its run, once, and is audited", async () => {
		const { cloud, control, audit } = await setup();
		const run = recordingHandle();
		control.register(RUN_ID, run.handle);

		expect(control.receive(stop(cloud))).toBe("applied");
		expect(run.stops).toEqual(["stopped_from_board"]);
		// The cloud may deliver a message twice: the second is a replay.
		expect(control.receive(stop(cloud))).toBe("duplicate");
		expect(run.stops).toHaveLength(1);
		expect(audit.map((a) => a.outcome)).toEqual(["applied", "duplicate"]);
		expect(audit[0]).toEqual({
			at: "2026-09-28T09:00:00.000Z",
			outcome: "applied",
			kind: "stop",
			messageId: "ctl_1",
			runId: RUN_ID,
			reason: "stopped_from_board",
		});
	});

	test("an unsigned control message is ignored and logged", async () => {
		const { cloud, control, audit } = await setup();
		const run = recordingHandle();
		control.register(RUN_ID, run.handle);
		const unsigned = message(cloud, "stop", { runId: RUN_ID });

		expect(control.receive(dark(unsigned))).toBe("ignored_unsigned");
		expect(run.stops).toEqual([]);
		expect(audit).toEqual([
			{
				at: "2026-09-28T09:00:00.000Z",
				outcome: "ignored_unsigned",
				kind: "stop",
				messageId: "ctl_1",
				runId: RUN_ID,
			},
		]);
		// Ignoring it records nothing: the same id signed later still applies.
		expect(control.receive(stop(cloud))).toBe("applied");
	});

	test("a message signed by a key the device does not trust is refused and logged", async () => {
		const { cloud, control, audit } = await setup();
		const run = recordingHandle();
		control.register(RUN_ID, run.handle);
		const rogue = generateKeyPairSync("ed25519").privateKey;
		const forged = cloud.signWith(rogue, {
			...message(cloud, "stop", { runId: RUN_ID }),
			keyId: cloud.controlKeyId,
		});

		expect(control.receive(forged)).toBe("refused");
		expect(run.stops).toEqual([]);
		expect(audit[0]).toMatchObject({
			outcome: "refused",
			code: "bad_signature",
		});
	});

	test("an expired message is refused", async () => {
		const { cloud, control, audit } = await setup();
		const run = recordingHandle();
		control.register(RUN_ID, run.handle);
		const late = stop(cloud, { expiresAt: "2026-09-28T08:59:30.000Z" });

		expect(control.receive(late)).toBe("refused");
		expect(run.stops).toEqual([]);
		expect(audit[0]).toMatchObject({ outcome: "refused", code: "expired" });
	});

	test("a message for a run not held here is left for the process that holds it", async () => {
		const { cloud, ports, control, audit } = await setup();
		expect(control.receive(stop(cloud))).toBe("not_ours");
		expect(audit).toEqual([]);

		// Another process holding the run still accepts it: nothing was recorded.
		const other = createRemoteControl(ports);
		const run = recordingHandle();
		other.register(RUN_ID, run.handle);
		expect(other.receive(stop(cloud))).toBe("applied");
		expect(run.stops).toEqual(["stopped_from_board"]);
	});

	test("an unregistered run no longer receives messages", async () => {
		const { cloud, control } = await setup();
		const run = recordingHandle();
		const unregister = control.register(RUN_ID, run.handle);
		unregister();
		expect(control.receive(stop(cloud))).toBe("not_ours");
		expect(run.stops).toEqual([]);
	});

	test("anything that is not a control message is refused, never thrown", async () => {
		const { control } = await setup();
		for (const raw of [null, "stop", 42, { kind: "stop" }]) {
			expect(control.receive(raw)).toBe("refused");
		}
	});

	test("a handler that throws is audited as failed", async () => {
		const { cloud, control, audit } = await setup();
		control.register(RUN_ID, {
			stop: () => {
				throw new Error("boom");
			},
			grantRevision: () => true,
		});
		expect(control.receive(stop(cloud))).toBe("failed");
		expect(audit[0]?.outcome).toBe("failed");
	});
});

describe("receive: revision grant", () => {
	test("a revision grant is applied exactly once", async () => {
		const { cloud, control, audit } = await setup();
		const run = recordingHandle();
		control.register(RUN_ID, run.handle);

		expect(control.receive(grant(cloud, "ctl_g1", "grant_1"))).toBe("applied");
		// Delivered again under a new message id: the same grant, not applied again.
		expect(control.receive(grant(cloud, "ctl_g2", "grant_1"))).toBe(
			"duplicate",
		);
		// A second grant: the run takes one revision, so the run refuses it.
		expect(control.receive(grant(cloud, "ctl_g3", "grant_2"))).toBe(
			"duplicate",
		);
		expect(run.granted).toEqual(["grant_1", "grant_2"]);
		expect(audit.map((a) => a.outcome)).toEqual([
			"applied",
			"duplicate",
			"duplicate",
		]);
		expect(audit[0]).toMatchObject({
			kind: "revision_grant",
			runId: RUN_ID,
			grantId: "grant_1",
		});
	});

	test("an unsigned revision grant is ignored", async () => {
		const { cloud, control } = await setup();
		const run = recordingHandle();
		control.register(RUN_ID, run.handle);
		const unsigned = message(cloud, "revision_grant", {
			runId: RUN_ID,
			grantId: "grant_1",
		});
		expect(control.receive(dark(unsigned))).toBe("ignored_unsigned");
		expect(run.granted).toEqual([]);
	});
});

describe("poll", () => {
	test("long-polls the control channel, delivers each message and resumes after the cursor", async () => {
		const { cloud, control } = await setup();
		const run = recordingHandle();
		control.register(RUN_ID, run.handle);
		cloud.state.controls.push(grant(cloud, "ctl_g1", "grant_1"));

		expect(await control.poll()).toBeLessThan(1_000);
		expect(run.granted).toEqual(["grant_1"]);
		cloud.state.controls.push(stop(cloud, { messageId: "ctl_s1" }));
		await control.poll();
		expect(run.stops).toEqual(["stopped_from_board"]);
		expect(cloud.state.controlWaits).toEqual([null, "1"]);
		const wait = cloud.requests.find((r) =>
			r.url.includes("/link/v1/control/wait"),
		);
		expect(wait?.url).toContain("timeout=");
	});

	test("nothing is polled with no run held here", async () => {
		const { cloud, control } = await setup();
		const wait = await control.poll();
		expect(wait).toBeGreaterThan(0);
		expect(cloud.state.controlWaits).toEqual([]);
	});

	test("an unenrolled device polls nothing", async () => {
		const { cloud, control } = await setup({ enrol: false });
		control.register(RUN_ID, recordingHandle().handle);
		const wait = await control.poll();
		expect(wait).toBeGreaterThan(0);
		expect(cloud.requests).toEqual([]);
	});

	test("an unreachable cloud backs off without throwing", async () => {
		const { cloud, control } = await setup();
		control.register(RUN_ID, recordingHandle().handle);
		cloud.state.offline = true;
		const wait = await control.poll();
		expect(wait).toBeGreaterThan(0);
	});
});
