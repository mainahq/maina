/**
 * Local-first retention measurement (FR-RET-7, FR-RET-8).
 *
 * The session history lives on this machine only, in
 * `~/.maina/retention.jsonl`: one JSON line per agent session start and per
 * retention surface seen (the status line, a terminal notification, the
 * weekly digest). It holds timestamps, Maina's own surface labels and the
 * host label: no paths, repository names, code or session ids. Nothing here
 * sends anything; sharing is a separate, opt-in step (`telemetry/retention-share`).
 *
 * Definitions, with day `n` meaning `n` whole days after the first session:
 *
 * - A return session is a session on day 1 or later.
 * - The day-7 window is days 7 to 13, the day-28 window days 28 to 34. A
 *   window is `returned` once it holds a return session, `pending` while it
 *   has not closed, and `missed` after it closed empty.
 * - A return session is attributed to the last surface seen before it, or
 *   `direct` when none was.
 *
 * Everything but `readRetentionLog` and `recordRetentionEvent` (which go
 * through the injected fs port) is pure.
 */

import { join } from "node:path";
import type { Result } from "../db/index";
import type { FsError, FsPort } from "../ports/fs";

export const RETENTION_SURFACES = [
	"statusline",
	"notification",
	"digest",
] as const;

export type RetentionSurface = (typeof RETENTION_SURFACES)[number];

/** What a return session is attributed to. */
export type Attribution = RetentionSurface | "direct";

export const ATTRIBUTIONS: readonly Attribution[] = [
	...RETENTION_SURFACES,
	"direct",
];

export type RetentionEvent =
	| Readonly<{
			kind: "session";
			/** Milliseconds since the Unix epoch. */
			ts: number;
			/** The agent host, as a label (`claude-code`, `cursor`, ...). */
			host?: string;
	  }>
	| Readonly<{ kind: "surface"; ts: number; surface: RetentionSurface }>;

export type ReturnSession = Readonly<{
	ts: number;
	/** Whole days since the first session. */
	day: number;
	host?: string;
	surface: Attribution;
}>;

export type WindowStatus = "pending" | "returned" | "missed";

export type RetentionWindow = Readonly<{
	day: 7 | 28;
	/** Start of the window, inclusive, in epoch ms. */
	opensAt: number;
	/** End of the window, exclusive, in epoch ms. */
	closesAt: number;
	status: WindowStatus;
	sessions: readonly ReturnSession[];
}>;

export type RetentionReport = Readonly<{
	firstSessionAt: number;
	/** Every session in the history, the first included. */
	sessions: number;
	returnSessions: readonly ReturnSession[];
	day7: RetentionWindow;
	day28: RetentionWindow;
	/** Return sessions per attribution, every key present. */
	attribution: Readonly<Record<Attribution, number>>;
}>;

export type ParsedRetentionLog = Readonly<{
	events: readonly RetentionEvent[];
	/** Lines that were not a valid event. */
	skipped: number;
}>;

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 7;
/** A surface seen again within this long is not written again. */
const SURFACE_REFRESH_MS = 5 * 60_000;
/** A session start this close to the last one is the same session. */
const SESSION_DEDUP_MS = 60_000;
/** The log keeps the first session and the newest events up to this many. */
const MAX_RETENTION_EVENTS = 5000;

const HOST_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

/** `~/.maina/retention.jsonl` for the home directory `home`. */
export function retentionLogFile(home: string): string {
	return join(home, ".maina", "retention.jsonl");
}

// ── Parse and serialise ─────────────────────────────────────────────────────

function isSurface(value: unknown): value is RetentionSurface {
	return (
		typeof value === "string" &&
		(RETENTION_SURFACES as readonly string[]).includes(value)
	);
}

function isTimestamp(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** A clean copy of `value` when it is a valid event, else undefined. */
function toRetentionEvent(value: unknown): RetentionEvent | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const v = value as Readonly<Record<string, unknown>>;
	if (!isTimestamp(v.ts)) return undefined;
	if (v.kind === "surface") {
		return isSurface(v.surface)
			? { kind: "surface", ts: v.ts, surface: v.surface }
			: undefined;
	}
	if (v.kind !== "session") return undefined;
	if (v.host === undefined) return { kind: "session", ts: v.ts };
	return typeof v.host === "string" && HOST_PATTERN.test(v.host)
		? { kind: "session", ts: v.ts, host: v.host }
		: undefined;
}

function parseLine(line: string): RetentionEvent | undefined {
	try {
		return toRetentionEvent(JSON.parse(line));
	} catch {
		return undefined;
	}
}

/** The events in a JSONL log; unreadable lines are counted, not fatal. */
export function parseRetentionLog(text: string): ParsedRetentionLog {
	const lines = text.split("\n").filter((line) => line.trim() !== "");
	const events: RetentionEvent[] = [];
	for (const line of lines) {
		const event = parseLine(line);
		if (event !== undefined) events.push(event);
	}
	return { events, skipped: lines.length - events.length };
}

/** One JSON line per event, newline-terminated. */
export function serializeRetentionLog(
	events: readonly RetentionEvent[],
): string {
	return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

// ── Append ──────────────────────────────────────────────────────────────────

function capped(events: readonly RetentionEvent[]): readonly RetentionEvent[] {
	if (events.length <= MAX_RETENTION_EVENTS) return events;
	const first = events.findIndex((event) => event.kind === "session");
	const newest = events.slice(events.length - MAX_RETENTION_EVENTS + 1);
	const firstSession = events[first];
	if (firstSession === undefined || first >= events.length - newest.length) {
		return events.slice(events.length - MAX_RETENTION_EVENTS);
	}
	return [firstSession, ...newest];
}

/**
 * The log after `event`, or null when nothing needs writing: a surface seen
 * again within five minutes of its last sighting, or a session start within
 * a minute of the last one. A surface seen again later replaces its last
 * sighting when nothing came between, so a status line redrawn all day is
 * one line. The log is capped at `MAX_RETENTION_EVENTS`, always keeping the
 * first session (the cohort start).
 */
export function appendRetentionEvent(
	events: readonly RetentionEvent[],
	event: RetentionEvent,
): readonly RetentionEvent[] | null {
	const last = events.at(-1);
	if (last !== undefined && event.kind === "surface") {
		if (last.kind === "surface" && last.surface === event.surface) {
			if (event.ts - last.ts < SURFACE_REFRESH_MS) return null;
			return [...events.slice(0, -1), event];
		}
	}
	if (
		last?.kind === "session" &&
		event.kind === "session" &&
		Math.abs(event.ts - last.ts) < SESSION_DEDUP_MS
	) {
		return null;
	}
	return capped([...events, event]);
}

// ── Read and record (through the fs port) ───────────────────────────────────

/** The local history; an empty one when the log does not exist yet. */
export async function readRetentionLog(
	fs: FsPort,
	file: string,
): Promise<Result<readonly RetentionEvent[], FsError>> {
	const read = await fs.readFile(file);
	if (!read.ok) {
		return read.error.kind === "not_found" ? { ok: true, value: [] } : read;
	}
	return { ok: true, value: parseRetentionLog(read.value).events };
}

/**
 * Adds `event` to the local log at `file`. Resolves to whether the log was
 * written (see `appendRetentionEvent`). Local only: takes no network port.
 */
export async function recordRetentionEvent(
	fs: FsPort,
	file: string,
	event: RetentionEvent,
): Promise<Result<boolean, FsError>> {
	const events = await readRetentionLog(fs, file);
	if (!events.ok) return events;
	const next = appendRetentionEvent(events.value, event);
	if (next === null) return { ok: true, value: false };
	const written = await fs.writeFile(file, serializeRetentionLog(next));
	return written.ok ? { ok: true, value: true } : written;
}

// ── Compute ─────────────────────────────────────────────────────────────────

function attribute(
	surfaces: readonly Extract<RetentionEvent, { kind: "surface" }>[],
	ts: number,
): Attribution {
	let seen: Attribution = "direct";
	for (const s of surfaces) {
		if (s.ts >= ts) break;
		seen = s.surface;
	}
	return seen;
}

function window(
	day: 7 | 28,
	first: number,
	returns: readonly ReturnSession[],
	now: number,
): RetentionWindow {
	const opensAt = first + day * DAY_MS;
	const closesAt = opensAt + WINDOW_DAYS * DAY_MS;
	const sessions = returns.filter((s) => s.ts >= opensAt && s.ts < closesAt);
	const status: WindowStatus =
		sessions.length > 0 ? "returned" : now < closesAt ? "pending" : "missed";
	return { day, opensAt, closesAt, status, sessions };
}

/**
 * Day-7 and day-28 returns and surface attribution from the local history,
 * as of `now`; null when the history holds no session.
 */
export function computeRetention(
	events: readonly RetentionEvent[],
	now: number,
): RetentionReport | null {
	const sorted = [...events].sort((a, b) => a.ts - b.ts);
	const sessions = sorted.filter(
		(e): e is Extract<RetentionEvent, { kind: "session" }> =>
			e.kind === "session",
	);
	const surfaces = sorted.filter(
		(e): e is Extract<RetentionEvent, { kind: "surface" }> =>
			e.kind === "surface",
	);
	const first = sessions[0]?.ts;
	if (first === undefined) return null;

	const returnSessions: ReturnSession[] = sessions
		.map((s) => ({ s, day: Math.floor((s.ts - first) / DAY_MS) }))
		.filter(({ day }) => day >= 1)
		.map(({ s, day }) => ({
			ts: s.ts,
			day,
			...(s.host === undefined ? {} : { host: s.host }),
			surface: attribute(surfaces, s.ts),
		}));

	const attribution = Object.fromEntries(
		ATTRIBUTIONS.map((a) => [
			a,
			returnSessions.filter((s) => s.surface === a).length,
		]),
	) as Record<Attribution, number>;

	return {
		firstSessionAt: first,
		sessions: sessions.length,
		returnSessions,
		day7: window(7, first, returnSessions, now),
		day28: window(28, first, returnSessions, now),
		attribution,
	};
}
