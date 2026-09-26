/**
 * Digest delivery (#350, FR-RET-5): off unless configured. A configured
 * webhook gets one JSON POST with the card; configured email goes through
 * the local `sendmail`. Only the card is sent, and every failure comes back
 * as a value.
 */

import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "../../config/index";
import { parseConfigLayer } from "../../config/schema";
import { createFakeProcess, createNetworkSpy } from "../../ports/testing";
import { buildDigestEmail } from "../deliver/email";
import {
	type ChannelResult,
	type DigestDelivery,
	deliverDigest,
	describeChannelError,
} from "../deliver/index";
import { buildWebhookRequest } from "../deliver/webhook";

const MESSAGE = {
	week: "2026-39",
	card: "Maina · week 2026-39\n12 agent actions checked: 4 blocked, 4 asked, 4 allowed",
};
const ROOT = "/repo";

function ports(networkStatus = 200, sendmailExit = 0) {
	return {
		network: createNetworkSpy(networkStatus),
		process: createFakeProcess({
			"sendmail -t -i": {
				exitCode: sendmailExit,
				stderr: sendmailExit === 0 ? "" : "sendmail: no route\nmore",
			},
		}),
		root: ROOT,
	};
}

describe("deliverDigest: off unless configured", () => {
	test.each([
		["no config", undefined],
		["an empty digest section", {}],
		["an empty recipient list", { email: { to: [] } }],
	] as const)("%s sends nothing", async (_label, delivery) => {
		const p = ports();
		const report = await deliverDigest(
			MESSAGE,
			delivery as DigestDelivery | undefined,
			p,
		);
		expect(report).toEqual({ kind: "off" });
		expect(p.network.calls()).toHaveLength(0);
		expect(p.process.calls()).toHaveLength(0);
	});
});

describe("deliverDigest: webhook", () => {
	test("posts the card once to the configured URL", async () => {
		const p = ports();
		const report = await deliverDigest(
			MESSAGE,
			{ webhook: { url: "https://hooks.example.com/T1/B2" } },
			p,
		);
		expect(report).toEqual({
			kind: "sent",
			results: [{ channel: "webhook", ok: true }],
		});
		const calls = p.network.calls();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://hooks.example.com/T1/B2");
		expect(JSON.parse(calls[0]?.body ?? "")).toEqual({ text: MESSAGE.card });
		expect(calls[0]?.headers["content-type"]).toBe("application/json");
		expect(p.process.calls()).toHaveLength(0);
	});

	test("an HTTP failure is a failed result, not a throw", async () => {
		const p = ports(500);
		const report = await deliverDigest(
			MESSAGE,
			{ webhook: { url: "https://hooks.example.com/x" } },
			p,
		);
		expect(report).toEqual({
			kind: "sent",
			results: [
				{ channel: "webhook", ok: false, error: { kind: "http", status: 500 } },
			],
		});
		const [failed] = report.kind === "sent" ? report.results : [];
		expect(
			describeChannelError(failed as Extract<ChannelResult, { ok: false }>),
		).toBe("webhook answered HTTP 500");
	});

	test("refuses a URL that is not https", () => {
		const built = buildWebhookRequest(MESSAGE, {
			url: "http://hooks.example.com/x",
		});
		expect(built).toEqual({ ok: false, error: { kind: "insecure_url" } });
	});

	test("no error message repeats the webhook URL", () => {
		for (const error of [
			{ kind: "insecure_url" },
			{ kind: "http", status: 404 },
			{ kind: "timeout", timeoutMs: 10_000 },
			{ kind: "unreachable" },
		] as const) {
			const text = describeChannelError({
				channel: "webhook",
				ok: false,
				error,
			});
			expect(text).not.toContain("hooks.example.com");
			expect(text.length).toBeGreaterThan(0);
		}
	});
});

describe("deliverDigest: email", () => {
	test("pipes one message to sendmail", async () => {
		const p = ports();
		const report = await deliverDigest(
			MESSAGE,
			{ email: { to: ["dev@example.com", "lead@example.com"] } },
			p,
		);
		expect(report).toEqual({
			kind: "sent",
			results: [{ channel: "email", ok: true }],
		});
		const [call] = p.process.calls();
		expect(call?.argv).toEqual(["sendmail", "-t", "-i"]);
		expect(call?.options.cwd).toBe(ROOT);
		const stdin = call?.options.stdin ?? "";
		expect(stdin).toContain("To: dev@example.com, lead@example.com\n");
		expect(stdin).toContain("Subject: Maina weekly digest 2026-39\n");
		expect(stdin.endsWith(`\n\n${MESSAGE.card}\n`)).toBe(true);
		expect(p.network.calls()).toHaveLength(0);
	});

	test("a sendmail failure is a failed result with its first stderr line", async () => {
		const p = ports(200, 1);
		const report = await deliverDigest(
			MESSAGE,
			{ email: { to: ["dev@example.com"] } },
			p,
		);
		expect(report).toEqual({
			kind: "sent",
			results: [
				{
					channel: "email",
					ok: false,
					error: { kind: "exit", exitCode: 1, detail: "sendmail: no route" },
				},
			],
		});
		const [failed] = report.kind === "sent" ? report.results : [];
		expect(
			describeChannelError(failed as Extract<ChannelResult, { ok: false }>),
		).toBe("sendmail exited 1: sendmail: no route");
	});

	test("sendmail missing is a failed result, not a throw", async () => {
		const report = await deliverDigest(
			MESSAGE,
			{ email: { to: ["dev@example.com"] } },
			{ ...ports(), process: createFakeProcess({}) },
		);
		expect(report.kind === "sent" && report.results[0]?.ok).toBe(false);
	});

	test("refuses addresses that could inject headers", () => {
		for (const to of [
			"dev@example.com\nBcc: all@example.com",
			"dev@example.com, other@example.com",
			"not-an-address",
		]) {
			expect(buildDigestEmail(MESSAGE, { to: [to] })).toEqual({
				ok: false,
				error: { kind: "invalid_address", address: to },
			});
		}
		expect(
			buildDigestEmail(MESSAGE, {
				to: ["dev@example.com"],
				from: "maina\r\nBcc: x@example.com",
			}).ok,
		).toBe(false);
	});

	test("both channels configured: both are tried, each reports alone", async () => {
		const p = ports(502, 0);
		const report = await deliverDigest(
			MESSAGE,
			{
				webhook: { url: "https://hooks.example.com/x" },
				email: { to: ["dev@example.com"] },
			},
			p,
		);
		expect(report).toEqual({
			kind: "sent",
			results: [
				{ channel: "webhook", ok: false, error: { kind: "http", status: 502 } },
				{ channel: "email", ok: true },
			],
		});
	});
});

describe("the digest section of .maina/config.json", () => {
	test("accepts a webhook and email recipients", () => {
		const parsed = parseConfigLayer(
			{
				digest: {
					webhook: { url: "https://hooks.example.com/x" },
					email: { to: ["dev@example.com"], from: "maina@example.com" },
				},
			},
			"/repo/.maina/config.json",
		);
		expect(parsed.ok).toBe(true);
	});

	test("rejects a plain-http webhook and a malformed address", () => {
		const parsed = parseConfigLayer(
			{
				digest: {
					webhook: { url: "http://hooks.example.com/x" },
					email: { to: ["dev@example.com\nBcc: x@example.com"] },
				},
			},
			"/repo/.maina/config.json",
		);
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) {
			expect(parsed.error.map((e) => e.path).sort()).toEqual([
				"digest.email.to[0]",
				"digest.webhook.url",
			]);
		}
	});

	test("the default config delivers nothing", () => {
		expect(getDefaultConfig().digest).toBeUndefined();
	});
});
