/**
 * Local-first retention measurement (FR-RET-7, FR-RET-8, FR-PRIV-1).
 *
 * - Day-7 and day-28 return sessions come from the local session history
 *   (`~/.maina/retention.jsonl`), nothing else.
 * - Each return session is attributed to the last surface seen before it.
 * - Nothing leaves the machine unless the user opted in: the share goes
 *   through a network port spy, and `globalThis.fetch` is trapped too.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	createFakeEnv,
	createMemoryFs,
	createNetworkSpy,
} from "../../ports/testing";
import {
	buildRetentionSharePayload,
	shareRetention,
	validateRetentionSharePayload,
} from "../../telemetry/retention-share";
import {
	appendRetentionEvent,
	computeRetention,
	parseRetentionLog,
	type RetentionEvent,
	readRetentionLog,
	recordRetentionEvent,
	retentionLogFile,
	serializeRetentionLog,
} from "../retention";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 9, 0, 0);
const HOME = "/home/dev";
const LOG = `${HOME}/.maina/retention.jsonl`;

const session = (day: number, hours = 0, host?: string): RetentionEvent => ({
	kind: "session",
	ts: T0 + day * DAY + hours * 3_600_000,
	...(host === undefined ? {} : { host }),
});

const surface = (
	day: number,
	name: "statusline" | "notification" | "digest",
	hours = 0,
): RetentionEvent => ({
	kind: "surface",
	surface: name,
	ts: T0 + day * DAY + hours * 3_600_000,
});

function nonNull<T>(value: T | null): T {
	if (value === null) throw new Error("unexpected null");
	return value;
}

function unwrap<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
	if (!r.ok) throw new Error(JSON.stringify(r.error));
	return r.value;
}

describe("retention log", () => {
	test("lives under the user's ~/.maina", () => {
		expect(retentionLogFile(HOME)).toBe(LOG);
	});

	test("round-trips through JSONL and skips lines it cannot read", () => {
		const events = [session(0, 0, "claude-code"), surface(1, "digest")];
		const text = `${serializeRetentionLog(events)}not json\n{"kind":"surface","ts":1,"surface":"billboard"}\n{"kind":"session","ts":-5}\n`;
		expect(parseRetentionLog(text)).toEqual({ events, skipped: 3 });
	});
});

describe("day-7 and day-28 return sessions from the local history", () => {
	test("no session history: no report", () => {
		expect(computeRetention([], T0)).toBeNull();
		expect(computeRetention([surface(0, "digest")], T0)).toBeNull();
	});

	test("a session on day 9 is a day-7 return; one on day 30 a day-28 return", () => {
		const report = computeRetention(
			[session(30), session(0), session(0, 2), session(9, 0, "cursor")],
			T0 + 40 * DAY,
		);
		expect(report?.firstSessionAt).toBe(T0);
		expect(report?.sessions).toBe(4);
		expect(report?.returnSessions.map((s) => s.day)).toEqual([9, 30]);
		expect(report?.day7).toEqual({
			day: 7,
			opensAt: T0 + 7 * DAY,
			closesAt: T0 + 14 * DAY,
			status: "returned",
			sessions: [
				{ ts: T0 + 9 * DAY, day: 9, host: "cursor", surface: "direct" },
			],
		});
		expect(report?.day28.status).toBe("returned");
		expect(report?.day28.sessions.map((s) => s.day)).toEqual([30]);
	});

	test("a same-day session is not a return", () => {
		const report = computeRetention([session(0), session(0, 20)], T0 + DAY);
		expect(report?.returnSessions).toEqual([]);
	});

	test("windows are pending until they close, then missed", () => {
		const events = [session(0), session(3)];
		const early = computeRetention(events, T0 + 10 * DAY);
		expect(early?.day7.status).toBe("pending");
		expect(early?.day28.status).toBe("pending");
		const late = computeRetention(events, T0 + 35 * DAY);
		expect(late?.day7.status).toBe("missed");
		expect(late?.day28.status).toBe("missed");
		expect(late?.returnSessions.map((s) => s.day)).toEqual([3]);
	});

	test("the day-7 window is days 7 to 13, the day-28 window days 28 to 34", () => {
		const report = computeRetention(
			[session(0), session(6), session(14), session(27), session(35)],
			T0 + 60 * DAY,
		);
		expect(report?.day7.status).toBe("missed");
		expect(report?.day28.status).toBe("missed");
		const edges = computeRetention(
			[session(0), session(7), session(13, 23), session(28), session(34, 23)],
			T0 + 60 * DAY,
		);
		expect(edges?.day7.sessions.length).toBe(2);
		expect(edges?.day28.sessions.length).toBe(2);
	});
});

describe("surface attribution", () => {
	test("each return session is attributed to the last surface seen before it", () => {
		const report = computeRetention(
			[
				session(0),
				surface(0, "statusline", 1),
				surface(5, "digest"),
				session(8),
				surface(8, "notification", 1),
				session(29),
				session(31),
			],
			T0 + 40 * DAY,
		);
		expect(report?.returnSessions.map((s) => [s.day, s.surface])).toEqual([
			[8, "digest"],
			[29, "notification"],
			[31, "notification"],
		]);
		expect(report?.day7.sessions[0]?.surface).toBe("digest");
		expect(report?.attribution).toEqual({
			statusline: 0,
			notification: 2,
			digest: 1,
			direct: 0,
		});
	});

	test("a return with no surface before it is direct; later surfaces never count", () => {
		const report = computeRetention(
			[session(0), session(8), surface(8, "digest", 1)],
			T0 + 20 * DAY,
		);
		expect(report?.returnSessions[0]?.surface).toBe("direct");
		expect(report?.attribution.direct).toBe(1);
	});
});

describe("recording", () => {
	test("appends sessions and surfaces to the local log", async () => {
		const fs = createMemoryFs();
		unwrap(await recordRetentionEvent(fs, LOG, session(0, 0, "claude-code")));
		unwrap(await recordRetentionEvent(fs, LOG, surface(1, "digest")));
		expect(unwrap(await readRetentionLog(fs, LOG))).toEqual([
			session(0, 0, "claude-code"),
			surface(1, "digest"),
		]);
	});

	test("a missing log reads as empty", async () => {
		expect(unwrap(await readRetentionLog(createMemoryFs(), LOG))).toEqual([]);
	});

	test("repeated sightings of one surface collapse into its latest", () => {
		const first = surface(1, "statusline");
		const soon = { ...first, ts: first.ts + 60_000 };
		const later = { ...first, ts: first.ts + 10 * 60_000 };
		expect(appendRetentionEvent([first], soon)).toBeNull();
		expect(appendRetentionEvent([first], later)).toEqual([later]);
		expect(appendRetentionEvent([first], surface(1, "digest"))).toEqual([
			first,
			surface(1, "digest"),
		]);
	});

	test("a second session start within a minute is the same session", () => {
		const start = session(0);
		expect(
			appendRetentionEvent([start], { ...start, ts: start.ts + 5_000 }),
		).toBeNull();
		expect(appendRetentionEvent([start], session(0, 1))).toEqual([
			start,
			session(0, 1),
		]);
	});

	test("a full log keeps the first session and drops the oldest after it", () => {
		const events: RetentionEvent[] = [session(0)];
		for (let i = 1; i < 5000; i++) events.push(session(0, i));
		const next = appendRetentionEvent(events, session(0, 6000));
		expect(next?.length).toBe(5000);
		expect(next?.[0]).toEqual(session(0));
		expect(next?.[1]).toEqual(session(0, 2));
		expect(next?.at(-1)).toEqual(session(0, 6000));
	});
});

// ── FR-PRIV-1: nothing leaves the machine without opt-in ─────────────────────

let fetchCalls: string[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
	fetchCalls = [];
	globalThis.fetch = (async (input: string | URL | Request) => {
		fetchCalls.push(String(input));
		return new Response(null, { status: 202 });
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function ports(files: Record<string, string> = {}, env = {}) {
	return {
		fs: createMemoryFs(files),
		env: createFakeEnv({ HOME, ...env }),
		network: createNetworkSpy(),
	};
}

const OPTED_IN = {
	[`${HOME}/.maina/policy.json`]: JSON.stringify({
		telemetry: { usage: true },
	}),
};

const REPORT = computeRetention(
	[
		session(0, 0, "claude-code"),
		surface(5, "digest"),
		session(8, 0, "claude-code"),
	],
	T0 + 20 * DAY,
);

describe("retention sharing — network spy", () => {
	test("default config: nothing on the port, no fetch", async () => {
		const p = ports();
		const result = await shareRetention(p, REPORT, {
			baseUrl: "https://cloud.test",
		});
		expect(result).toEqual({
			ok: true,
			value: { sent: 0, skipped: "not_opted_in" },
		});
		expect(p.network.calls()).toEqual([]);
		expect(fetchCalls).toEqual([]);
	});

	test("a kill switch wins over the opt-in", async () => {
		const p = ports(OPTED_IN, { DO_NOT_TRACK: "1" });
		const result = await shareRetention(p, REPORT, {
			baseUrl: "https://cloud.test",
		});
		expect(unwrap(result)).toEqual({ sent: 0, skipped: "not_opted_in" });
		expect(p.network.calls()).toEqual([]);
		expect(fetchCalls).toEqual([]);
	});

	test("recording never touches the network", async () => {
		const fs = createMemoryFs();
		unwrap(await recordRetentionEvent(fs, LOG, session(0)));
		expect(fetchCalls).toEqual([]);
	});

	test("opted in: one POST through the port with the closed payload", async () => {
		const p = ports(OPTED_IN);
		const result = await shareRetention(p, REPORT, {
			baseUrl: "https://cloud.test/",
		});
		expect(unwrap(result)).toEqual({ sent: 1 });
		const calls = p.network.calls();
		expect(calls.map((c) => c.url)).toEqual([
			"https://cloud.test/v1/retention",
		]);
		expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
			v: 1,
			day7: "returned",
			day7Surface: "digest",
			day28: "pending",
			attribution: { statusline: 0, notification: 0, digest: 1, direct: 0 },
		});
		expect(fetchCalls).toEqual([]);
	});

	test("opted in with no history: nothing to send", async () => {
		const p = ports(OPTED_IN);
		const result = await shareRetention(p, null, {
			baseUrl: "https://cloud.test",
		});
		expect(unwrap(result)).toEqual({ sent: 0 });
		expect(p.network.calls()).toEqual([]);
	});
});

describe("retention share payload", () => {
	test("carries statuses and counts, never timestamps or hosts", () => {
		const payload = unwrap(buildRetentionSharePayload(nonNull(REPORT)));
		expect(Object.keys(payload).sort()).toEqual([
			"attribution",
			"day28",
			"day7",
			"day7Surface",
			"v",
		]);
		expect(JSON.stringify(payload)).not.toContain("claude-code");
		expect(JSON.stringify(payload)).not.toContain(String(T0));
	});

	test("rejects extra fields and unknown labels", () => {
		const payload = unwrap(buildRetentionSharePayload(nonNull(REPORT)));
		expect(
			validateRetentionSharePayload({ ...payload, firstSessionAt: T0 }).ok,
		).toBe(false);
		expect(
			validateRetentionSharePayload({ ...payload, day7: "maybe" }).ok,
		).toBe(false);
		expect(
			validateRetentionSharePayload({
				...payload,
				attribution: { ...payload.attribution, billboard: 1 },
			}).ok,
		).toBe(false);
		expect(
			validateRetentionSharePayload({
				...payload,
				attribution: { ...payload.attribution, digest: -1 },
			}).ok,
		).toBe(false);
	});
});
