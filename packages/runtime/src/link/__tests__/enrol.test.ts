/**
 * Device enrolment (#589, spec §6.3 "Enrol", FR-ID-6).
 *
 * The device generates its Ed25519 key pair locally, proves possession to
 * the cloud and keeps the private key in an owner-only file. These run
 * against the in-process fake cloud, which verifies the proof itself.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { testTmpDir } from "../../__tests__/test-tmp";
import { type EnrolOptions, enrolDevice } from "../enrol";
import { nodeLinkCrypto } from "../keys";
import { fileLinkStore } from "../store";
import { type FakeCloud, fakeCloud } from "./fake-cloud";

let dir: string;

beforeEach(() => {
	dir = testTmpDir("maina-link-enrol-");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const linkDir = () => join(dir, "link");

function portsFor(cloud: FakeCloud) {
	let now = Date.parse("2026-09-28T09:00:00.000Z");
	const sleeps: number[] = [];
	return {
		sleeps,
		ports: {
			http: cloud.http,
			store: fileLinkStore(linkDir()),
			crypto: nodeLinkCrypto,
			clock: () => new Date(now),
			sleep: async (ms: number) => {
				sleeps.push(ms);
				now += ms;
			},
		},
	};
}

function options(cloud: FakeCloud, extra: Partial<EnrolOptions> = {}) {
	return {
		baseUrl: cloud.baseUrl,
		device: { os: "darwin", arch: "arm64", runtimeVersion: "1.8.1" },
		...extra,
	} as EnrolOptions;
}

/** Everything the device sent the cloud, as one string. */
const sent = (cloud: FakeCloud): string =>
	cloud.requests
		.map((r) => `${r.url}\n${JSON.stringify(r.headers)}\n${r.body ?? ""}`)
		.join("\n");

const mode = (path: string): number => statSync(path).mode & 0o777;

describe("enrolDevice", () => {
	test("a workstation enrols through the device code: prompt, poll, proof, pinned org keys", async () => {
		const cloud = fakeCloud({ pendingPolls: 2 });
		const { ports, sleeps } = portsFor(cloud);
		const prompts: unknown[] = [];
		const enrolled = await enrolDevice(
			ports,
			options(cloud, { onUserCode: (p) => prompts.push(p) }),
		);
		expect(enrolled.ok).toBe(true);
		if (!enrolled.ok) return;
		expect(prompts).toEqual([
			{
				userCode: "WDJB-MJHT",
				verificationUri: "https://app.cloud.test/enrol",
				expiresIn: 600,
			},
		]);
		// Two `authorization_pending` answers, polled every `interval` seconds.
		expect(cloud.state.completions).toBe(3);
		expect(sleeps).toEqual([5000, 5000]);
		expect(cloud.state.proofVerified).toBe(true);
		const device = enrolled.value;
		expect(device.enrolment.deviceId).toBe("dev_01J9Z3K4T8QX");
		expect(device.enrolment.orgId).toBe("org_acme");
		expect(device.enrolment.orgKeys.map((k) => k.purpose).sort()).toEqual([
			"approval-resolution",
			"link-control",
			"policy-bundle",
		]);
		expect(device.publicKey).toBe(cloud.state.devicePublicKey ?? "");
		expect(device.kind).toBe("workstation");
		expect(device.revokedAt).toBeNull();
		// The state is on disk for the next process.
		const reread = fileLinkStore(linkDir()).readState();
		expect(reread.ok && reread.value?.enrolment.deviceId).toBe(
			"dev_01J9Z3K4T8QX",
		);
	});

	test("the private key is written owner-only and never sent", async () => {
		const cloud = fakeCloud();
		const { ports } = portsFor(cloud);
		const enrolled = await enrolDevice(ports, options(cloud));
		expect(enrolled.ok).toBe(true);
		const keyFile = join(linkDir(), "device.key");
		const stateFile = join(linkDir(), "device.json");
		const pem = readFileSync(keyFile, "utf-8");
		expect(pem).toContain("PRIVATE KEY");
		if (process.platform !== "win32") {
			expect(mode(linkDir()) & 0o077).toBe(0);
			expect(mode(keyFile) & 0o077).toBe(0);
			expect(mode(stateFile) & 0o077).toBe(0);
		}
		// Neither the PEM nor its base64 body (the key bytes) left the machine.
		const body = pem
			.split("\n")
			.filter((l) => l !== "" && !l.startsWith("-----"))
			.join("");
		// PKCS#8 Ed25519: the last 32 bytes of the DER are the private seed.
		const der = Buffer.from(body, "base64");
		const seed = der.subarray(der.length - 32);
		const encodings = [
			body,
			seed.toString("base64url"),
			seed.toString("base64").replace(/=+$/, ""),
			seed.toString("hex"),
		];
		const wire = sent(cloud);
		const state = readFileSync(stateFile, "utf-8");
		for (const secret of encodings) {
			expect(wire).not.toContain(secret);
			expect(state).not.toContain(secret);
		}
	});

	test("a key file that is group- or world-readable is re-written owner-only", async () => {
		if (process.platform === "win32") return;
		const store = fileLinkStore(linkDir());
		expect(store.writePrivateKey("old").ok).toBe(true);
		const keyFile = join(linkDir(), "device.key");
		chmodSync(keyFile, 0o644);
		expect(store.writePrivateKey("new").ok).toBe(true);
		expect(mode(keyFile)).toBe(0o600);
	});

	test("a private key readable by others is refused, not used", () => {
		if (process.platform === "win32") return;
		const store = fileLinkStore(linkDir());
		expect(store.writePrivateKey("pem").ok).toBe(true);
		chmodSync(join(linkDir(), "device.key"), 0o640);
		const read = store.readPrivateKey();
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.error.kind).toBe("insecure_key");
	});

	test("a CI runner enrols with its scoped token on start only, and nobody is prompted", async () => {
		const cloud = fakeCloud({ ciToken: "mat_ci_scoped_token_0123456789" });
		const { ports } = portsFor(cloud);
		const prompts: unknown[] = [];
		const enrolled = await enrolDevice(
			ports,
			options(cloud, {
				ciToken: "mat_ci_scoped_token_0123456789",
				onUserCode: (p) => prompts.push(p),
			}),
		);
		expect(enrolled.ok).toBe(true);
		if (!enrolled.ok) return;
		expect(enrolled.value.kind).toBe("ci");
		expect(prompts).toEqual([]);
		const [start, complete] = cloud.requests;
		expect(JSON.parse(start?.body ?? "{}").kind).toBe("ci");
		expect(start?.headers.Authorization).toBe(
			"Bearer mat_ci_scoped_token_0123456789",
		);
		expect(complete?.headers.Authorization).toBeUndefined();
	});

	test("a refused completion leaves nothing behind", async () => {
		const cloud = fakeCloud({ refuseCompleteWith: "expired_code" });
		const { ports } = portsFor(cloud);
		const enrolled = await enrolDevice(ports, options(cloud));
		expect(enrolled.ok).toBe(false);
		if (enrolled.ok) return;
		expect(enrolled.error).toMatchObject({
			kind: "refused",
			code: "expired_code",
		});
		expect(existsSync(join(linkDir(), "device.key"))).toBe(false);
		expect(existsSync(join(linkDir(), "device.json"))).toBe(false);
	});

	test("an approval that never comes stops at the code's expiry", async () => {
		const cloud = fakeCloud({ pendingPolls: 1_000 });
		const { ports } = portsFor(cloud);
		const enrolled = await enrolDevice(ports, options(cloud));
		expect(enrolled.ok).toBe(false);
		if (!enrolled.ok) expect(enrolled.error.kind).toBe("expired");
		// 600 s at a 5 s interval.
		expect(cloud.state.completions).toBeLessThanOrEqual(121);
		expect(existsSync(join(linkDir(), "device.key"))).toBe(false);
	});

	test("an org without a key for every purpose is refused: a device must be able to verify rotations", async () => {
		const cloud = fakeCloud({ omitPurposes: ["link-control"] });
		const { ports } = portsFor(cloud);
		const enrolled = await enrolDevice(ports, options(cloud));
		expect(enrolled.ok).toBe(false);
		if (!enrolled.ok) {
			expect(enrolled.error).toMatchObject({
				kind: "org_keys_incomplete",
				missing: ["link-control"],
			});
		}
		expect(existsSync(join(linkDir(), "device.json"))).toBe(false);
	});

	test("an enrolled device is not enrolled twice", async () => {
		const cloud = fakeCloud();
		const { ports } = portsFor(cloud);
		expect((await enrolDevice(ports, options(cloud))).ok).toBe(true);
		const before = cloud.requests.length;
		const again = await enrolDevice(ports, options(cloud));
		expect(again.ok).toBe(false);
		if (!again.ok) expect(again.error.kind).toBe("already_enrolled");
		expect(cloud.requests.length).toBe(before);
	});

	test("plain http is refused except to this machine", async () => {
		const cloud = fakeCloud();
		const { ports } = portsFor(cloud);
		const refused = await enrolDevice(
			ports,
			options(cloud, { baseUrl: "http://cloud.example.com" }),
		);
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.error.kind).toBe("insecure_url");
		expect(cloud.requests).toEqual([]);
	});

	test("a start answer that is not the published shape is refused", async () => {
		const cloud = fakeCloud();
		const { ports } = portsFor(cloud);
		const enrolled = await enrolDevice(
			{
				...ports,
				http: {
					request: async () => ({
						ok: true,
						value: {
							status: 200,
							body: JSON.stringify({
								data: { v: 1, deviceCode: "short" },
								error: null,
							}),
						},
					}),
				},
			},
			options(cloud),
		);
		expect(enrolled.ok).toBe(false);
		if (!enrolled.ok) expect(enrolled.error.kind).toBe("invalid_response");
	});

	test("a label outside the published pattern is refused before anything is sent", async () => {
		const cloud = fakeCloud();
		const { ports } = portsFor(cloud);
		const enrolled = await enrolDevice(
			ports,
			options(cloud, {
				device: {
					os: "linux",
					arch: "x64",
					runtimeVersion: "1.8.1",
					label: "Bob's /home/bob laptop",
				},
			}),
		);
		expect(enrolled.ok).toBe(false);
		if (!enrolled.ok) expect(enrolled.error.kind).toBe("invalid_request");
		expect(cloud.requests).toEqual([]);
	});
});

describe("fileLinkStore", () => {
	test("state written by one store reads back in another", async () => {
		const cloud = fakeCloud();
		const { ports } = portsFor(cloud);
		await enrolDevice(ports, options(cloud));
		const again = fileLinkStore(linkDir()).readState();
		expect(again.ok).toBe(true);
	});

	test("a corrupt state file is an error, not an empty store", () => {
		const store = fileLinkStore(linkDir());
		expect(store.writePrivateKey("pem").ok).toBe(true);
		writeFileSync(join(linkDir(), "device.json"), "{not json", {
			mode: 0o600,
		});
		const read = store.readState();
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.error.kind).toBe("corrupt_state");
	});

	test("clear removes the key and the state", async () => {
		const cloud = fakeCloud();
		const { ports } = portsFor(cloud);
		await enrolDevice(ports, options(cloud));
		const store = fileLinkStore(linkDir());
		expect(store.clear().ok).toBe(true);
		expect(existsSync(join(linkDir(), "device.key"))).toBe(false);
		expect(existsSync(join(linkDir(), "device.json"))).toBe(false);
		const read = store.readState();
		expect(read.ok && read.value).toBeNull();
	});
});
