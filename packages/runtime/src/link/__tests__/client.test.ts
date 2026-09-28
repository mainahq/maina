/**
 * The Link client (#589, spec §6.3, FR-ID-6): key-bound short-lived tokens
 * bought with a signed challenge, one refresh on a 401, and a stop on
 * `device_revoked`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { testTmpDir } from "../../__tests__/test-tmp";
import { createLinkClient } from "../client";
import { enrolDevice } from "../enrol";
import { nodeLinkCrypto } from "../keys";
import { deviceStatus, fileLinkStore } from "../store";
import { linkToken } from "../token";
import { type FakeCloud, fakeCloud } from "./fake-cloud";

let dir: string;

beforeEach(() => {
	dir = testTmpDir("maina-link-client-");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-09-28T09:00:00.000Z");

async function enrolled(cloud: FakeCloud) {
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
	cloud.requests.length = 0;
	return ports;
}

const event = { method: "POST" as const, path: "/link/v1/events", body: {} };

describe("linkToken", () => {
	test("buys a device-bound token with a challenge signed by the device key", async () => {
		const cloud = fakeCloud();
		const ports = await enrolled(cloud);
		const token = await linkToken(ports);
		expect(token.ok).toBe(true);
		if (!token.ok) return;
		expect(token.value.token).toMatch(/^lat_/);
		expect(token.value.expiresAt).toBe(NOW + 900_000);
		expect(cloud.state.challengesVerified).toBe(1);
		const challenge = JSON.parse(cloud.requests[0]?.body ?? "{}");
		expect(challenge.deviceId).toBe("dev_01J9Z3K4T8QX");
		expect(challenge.ts).toBe("2026-09-28T09:00:00.000Z");
	});

	test("each challenge carries a fresh nonce", async () => {
		const cloud = fakeCloud();
		const ports = await enrolled(cloud);
		expect((await linkToken(ports)).ok).toBe(true);
		expect((await linkToken(ports)).ok).toBe(true);
		const [a, b] = cloud.requests.map((r) => JSON.parse(r.body ?? "{}").nonce);
		expect(a).not.toBe(b);
	});

	test("the token is never written to disk", async () => {
		const cloud = fakeCloud();
		const ports = await enrolled(cloud);
		const token = await linkToken(ports);
		if (!token.ok) throw new Error("no token");
		const linkDir = join(dir, "link");
		for (const file of readdirSync(linkDir)) {
			expect(readFileSync(join(linkDir, file), "utf-8")).not.toContain(
				token.value.token,
			);
		}
	});

	test("an unenrolled device has nothing to sign with", async () => {
		const cloud = fakeCloud();
		const token = await linkToken({
			http: cloud.http,
			store: fileLinkStore(join(dir, "link")),
			crypto: nodeLinkCrypto,
			clock: () => new Date(NOW),
		});
		expect(token.ok).toBe(false);
		if (!token.ok) expect(token.error.kind).toBe("not_enrolled");
		expect(cloud.requests).toEqual([]);
	});
});

describe("createLinkClient", () => {
	test("presents the token as a bearer and reuses it while it is fresh", async () => {
		const cloud = fakeCloud();
		const client = createLinkClient(await enrolled(cloud));
		expect((await client.send(event)).ok).toBe(true);
		expect((await client.send(event)).ok).toBe(true);
		expect(cloud.state.tokenExchanges).toBe(1);
		expect(cloud.state.eventCalls).toBe(2);
	});

	test("a path that is not a Link endpoint path never carries the token", async () => {
		const cloud = fakeCloud();
		const client = createLinkClient(await enrolled(cloud));
		for (const path of [
			"@evil.example/steal",
			"//evil.example/link/v1/events",
			"link/v1/events",
			"/link/v1/../../admin",
			"/link/v1/events?x=1",
			"https://evil.example/link/v1/events",
		]) {
			const sent = await client.send({ method: "POST", path, body: {} });
			expect(sent.ok).toBe(false);
			if (!sent.ok) expect(sent.error.kind).toBe("invalid_path");
		}
		expect(cloud.requests).toEqual([]);
	});

	test("a 401 triggers exactly one token refresh, then the call is retried", async () => {
		const cloud = fakeCloud();
		const client = createLinkClient(await enrolled(cloud));
		expect((await client.send(event)).ok).toBe(true);
		cloud.expireIssuedTokens();
		const retried = await client.send(event);
		expect(retried.ok).toBe(true);
		expect(cloud.state.tokenExchanges).toBe(2);
		expect(cloud.state.eventCalls).toBe(3);
	});

	test("a second 401 after the refresh is an error, not a loop", async () => {
		const cloud = fakeCloud();
		cloud.state.alwaysExpire = true;
		const client = createLinkClient(await enrolled(cloud));
		const failed = await client.send(event);
		expect(failed.ok).toBe(false);
		if (!failed.ok) {
			expect(failed.error).toMatchObject({
				kind: "refused",
				code: "token_expired",
			});
		}
		expect(cloud.state.tokenExchanges).toBe(2);
		expect(cloud.state.eventCalls).toBe(2);
	});

	test("device_revoked stops Link: marked in the state, no further calls, shown in the status", async () => {
		const cloud = fakeCloud();
		const ports = await enrolled(cloud);
		const client = createLinkClient(ports);
		expect((await client.send(event)).ok).toBe(true);
		cloud.state.revoked = true;
		const refused = await client.send(event);
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.error.kind).toBe("revoked");
		const calls = cloud.requests.length;
		const again = await client.send(event);
		expect(again.ok).toBe(false);
		if (!again.ok) expect(again.error.kind).toBe("revoked");
		expect(cloud.requests.length).toBe(calls);
		// A new process sees it too, without asking the cloud.
		const fresh = createLinkClient({
			...ports,
			store: fileLinkStore(join(dir, "link")),
		});
		const later = await fresh.send(event);
		expect(later.ok).toBe(false);
		if (!later.ok) expect(later.error.kind).toBe("revoked");
		expect(cloud.requests.length).toBe(calls);
		const status = deviceStatus(fileLinkStore(join(dir, "link")));
		expect(status).toMatchObject({
			kind: "revoked",
			deviceId: "dev_01J9Z3K4T8QX",
			revokedAt: "2026-09-28T09:00:00.000Z",
		});
	});

	test("device_revoked stops this client even when the revocation cannot be recorded", async () => {
		const cloud = fakeCloud();
		const ports = await enrolled(cloud);
		const readOnly = {
			...ports.store,
			writeState: () => ({
				ok: false as const,
				error: { kind: "store" as const, op: "write", message: "EROFS" },
			}),
		};
		for (const revokedOn of ["call", "token"] as const) {
			const client = createLinkClient({ ...ports, store: readOnly });
			if (revokedOn === "call") {
				cloud.state.revoked = false;
				expect((await client.send(event)).ok).toBe(true);
			}
			cloud.state.revoked = true;
			const refused = await client.send(event);
			expect(refused.ok).toBe(false);
			if (!refused.ok) {
				expect(refused.error).toMatchObject({ kind: "revoked" });
				if (refused.error.kind === "revoked") {
					expect(refused.error.unrecorded).toMatchObject({ kind: "store" });
				}
			}
			const calls = cloud.requests.length;
			const again = await client.send(event);
			expect(again.ok).toBe(false);
			if (!again.ok) expect(again.error.kind).toBe("revoked");
			expect(cloud.requests.length).toBe(calls);
		}
	});

	test("a body that cannot be serialised is an error value, never a throw", async () => {
		const cloud = fakeCloud();
		const client = createLinkClient(await enrolled(cloud));
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		const sent = await client.send({ ...event, body: cyclic });
		expect(sent.ok).toBe(false);
		if (!sent.ok) expect(sent.error.kind).toBe("invalid_body");
		const big = await client.send({ ...event, body: { n: 1n } });
		expect(big.ok).toBe(false);
	});

	test("device_revoked on the token exchange stops Link too", async () => {
		const cloud = fakeCloud();
		const ports = await enrolled(cloud);
		cloud.state.revoked = true;
		const token = await linkToken(ports);
		expect(token.ok).toBe(false);
		if (!token.ok) expect(token.error.kind).toBe("revoked");
		expect(deviceStatus(ports.store).kind).toBe("revoked");
	});

	test("an unreachable cloud is an error value, never a throw", async () => {
		const cloud = fakeCloud();
		const ports = await enrolled(cloud);
		const client = createLinkClient({
			...ports,
			http: {
				request: async (req) => ({
					ok: false,
					error: { kind: "network", url: req.url, message: "offline" },
				}),
			},
		});
		const failed = await client.send(event);
		expect(failed.ok).toBe(false);
		if (!failed.ok) expect(failed.error.kind).toBe("network");
	});
});
