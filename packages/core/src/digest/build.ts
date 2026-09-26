/**
 * Weekly digest metrics (FR-RET-5, FR-DOG-4): what the gate did over one
 * ISO week. Generalised from the dogfood report (`scripts/dogfood/report.ts`,
 * now a thin caller): events come from either source and are counted the
 * same way.
 *
 * - The gate log: the dogfood hook's `log.jsonl`, one JSON record per gated
 *   tool call (`parseGateLog`, then `gateLogEvents`).
 * - The decision log: the repository's `action.risk` decisions with their
 *   gate subjects and override outcomes (`decisionLogEvents`).
 *
 * Pure: callers read the log and pick the week.
 */

import { type LogSlice, SHADOW_ACTION } from "../decide/evidence";
import type { DecisionRecord } from "../decide/log/schema";
import { REVERSED_SUFFIX } from "../gate/evaluate";
import { DEFAULT_POLICY } from "../policy/defaults";

export type DigestVerdict = "allow" | "ask" | "deny";

/** One line of the gate log (`{ ts, tool, action, verdict, reason, override? }`). */
type GateLogRecord = Readonly<{
	/** ISO-8601 timestamp. */
	ts: string;
	tool: string;
	action: string;
	verdict: DigestVerdict;
	reason: string;
	override?: true;
}>;

/** One gated action, whichever log it came from. */
export type DigestEvent = Readonly<{
	/** Milliseconds since the Unix epoch. */
	ts: number;
	/** What was gated: a host tool name, or a gate event kind. */
	tool: string;
	verdict: DigestVerdict;
	/** The rule or action class behind the verdict. */
	rule: string;
	/** The user overrode the verdict. */
	override: boolean;
	/** The hook crashed and failed closed to `ask`. */
	crash: boolean;
}>;

export type WeeklyDigest = Readonly<{
	week: string;
	total: number;
	verdicts: Readonly<Record<DigestVerdict, number>>;
	denyRate: number;
	askRate: number;
	overrides: number;
	/** overrides / (denies + overrides): how often a deny was contested. */
	overrideRate: number;
	/** Hook crashes that failed closed to `ask`. */
	crashes: number;
	byTool: Readonly<Record<string, number>>;
	topDenyRules: ReadonlyArray<Readonly<{ rule: string; count: number }>>;
}>;

/** A week's span: `since` inclusive, `until` exclusive, in epoch ms. */
export type WeekBounds = Readonly<{ since: number; until: number }>;

/** What a gate decision was about, as the digest needs it. */
export type DigestSubject = Readonly<{
	kind: string;
	classes: readonly string[];
}>;

const DAY_MS = 86_400_000;
const WEEK_RE = /^(\d{4})-(\d{2})$/;
const VERDICTS: ReadonlySet<string> = new Set(["allow", "ask", "deny"]);
const MAX_DENY_RULES = 10;
const UNKNOWN = "unknown";

// ── Weeks ───────────────────────────────────────────────────────────────────

/** ISO-8601 week key `yyyy-ww` (UTC) for an ISO timestamp or epoch ms. */
export function isoWeek(ts: string | number): string {
	const d = new Date(ts);
	const date = new Date(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
	);
	// Thursday of this week decides the ISO year.
	const day = date.getUTCDay() || 7;
	date.setUTCDate(date.getUTCDate() + 4 - day);
	const year = date.getUTCFullYear();
	const jan1 = Date.UTC(year, 0, 1);
	const week = Math.ceil(((date.getTime() - jan1) / DAY_MS + 1) / 7);
	return `${year}-${String(week).padStart(2, "0")}`;
}

/** Whether `week` is a `yyyy-ww` key naming a week that exists. */
export function isWeekKey(week: string): boolean {
	const match = WEEK_RE.exec(week);
	if (match === null) return false;
	const year = Number(match[1]);
	const number = Number(match[2]);
	// December 28th always falls in the ISO year's last week.
	const last = Number(isoWeek(Date.UTC(year, 11, 28)).slice(5));
	return year >= 1970 && number >= 1 && number <= last;
}

/** Monday 00:00 UTC of `week` to the next Monday. `week` must pass `isWeekKey`. */
export function weekBounds(week: string): WeekBounds {
	const year = Number(week.slice(0, 4));
	const number = Number(week.slice(5));
	// January 4th is always in week 1.
	const jan4 = Date.UTC(year, 0, 4);
	const day = new Date(jan4).getUTCDay() || 7;
	const since = jan4 - (day - 1) * DAY_MS + (number - 1) * 7 * DAY_MS;
	return { since, until: since + 7 * DAY_MS };
}

// ── Gate log ────────────────────────────────────────────────────────────────

function asRecord(v: unknown): GateLogRecord | undefined {
	if (typeof v !== "object" || v === null) return undefined;
	const r = v as Record<string, unknown>;
	if (
		typeof r.ts !== "string" ||
		Number.isNaN(Date.parse(r.ts)) ||
		typeof r.tool !== "string" ||
		typeof r.action !== "string" ||
		typeof r.verdict !== "string" ||
		!VERDICTS.has(r.verdict) ||
		typeof r.reason !== "string"
	) {
		return undefined;
	}
	return r as unknown as GateLogRecord;
}

/** The gate log's valid records, and how many lines were not one. */
export function parseGateLog(text: string): Readonly<{
	records: readonly GateLogRecord[];
	malformed: number;
}> {
	const records: GateLogRecord[] = [];
	let malformed = 0;
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		try {
			const rec = asRecord(JSON.parse(line));
			if (rec) records.push(rec);
			else malformed++;
		} catch {
			malformed++;
		}
	}
	return { records, malformed };
}

/** Rule id is the reason prefix before the first colon (e.g. `protected-push`). */
function ruleOf(reason: string): string {
	return reason.replace(/^\[override\]\s*/, "").split(":")[0] ?? reason;
}

/** Gate log records as digest events. */
export function gateLogEvents(
	records: readonly GateLogRecord[],
): readonly DigestEvent[] {
	return records.map((r) => ({
		ts: Date.parse(r.ts),
		tool: r.tool,
		verdict: r.verdict,
		rule: ruleOf(r.reason),
		override: Boolean(r.override),
		crash: r.reason.startsWith("hook crash"),
	}));
}

// ── Decision log ────────────────────────────────────────────────────────────

const GATE_TYPE = "action.risk";

function baseId(id: string): string {
	return id.endsWith(REVERSED_SUFFIX)
		? id.slice(0, -REVERSED_SUFFIX.length)
		: id;
}

/** The class that explains the verdict: the first one not allowed by default. */
function ruleOfSubject(subject: DigestSubject | undefined): string {
	if (subject === undefined) return UNKNOWN;
	const risky = subject.classes.find(
		(c) => DEFAULT_POLICY.action_classes[c]?.verdict !== "allow",
	);
	return risky ?? subject.classes[0] ?? UNKNOWN;
}

/**
 * One event per served gate decision in `slice` (both halves of a two-order
 * check count once; shadow records and other decision types are left out),
 * oldest first. `subjects`, keyed by decision id, name what was gated; an
 * `override` outcome on either half marks the event overridden.
 */
export function decisionLogEvents(
	slice: LogSlice,
	subjects: ReadonlyMap<string, DigestSubject> = new Map(),
): readonly DigestEvent[] {
	const overridden = new Set(
		slice.outcomes
			.filter((o) => o.outcome === "override")
			.map((o) => o.decisionId),
	);
	const groups = new Map<string, DecisionRecord[]>();
	for (const record of slice.decisions) {
		if (record.type !== GATE_TYPE || record.finalAction === SHADOW_ACTION) {
			continue;
		}
		const key = baseId(record.id);
		groups.set(key, [...(groups.get(key) ?? []), record]);
	}
	const events: Array<Readonly<{ key: string; event: DigestEvent }>> = [];
	for (const [key, records] of groups) {
		const primary = records.find((r) => r.id === key) ?? records[0];
		if (primary === undefined || !VERDICTS.has(primary.finalAction)) continue;
		const subject =
			subjects.get(key) ??
			records.map((r) => subjects.get(r.id)).find((s) => s !== undefined);
		events.push({
			key,
			event: {
				ts: primary.ts,
				tool: subject?.kind ?? UNKNOWN,
				verdict: primary.finalAction as DigestVerdict,
				rule: ruleOfSubject(subject),
				override: records.some((r) => overridden.has(r.id)),
				crash: false,
			},
		});
	}
	return events
		.sort(
			(a, b) =>
				a.event.ts - b.event.ts || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
		)
		.map((e) => e.event);
}

// ── Metrics ─────────────────────────────────────────────────────────────────

const ratio = (n: number, d: number): number => (d === 0 ? 0 : n / d);

/** The digest of the events that fall in `week`. */
export function buildDigest(
	events: readonly DigestEvent[],
	week: string,
): WeeklyDigest {
	const inWeek = events.filter((e) => isoWeek(e.ts) === week);
	const verdicts: Record<DigestVerdict, number> = { allow: 0, ask: 0, deny: 0 };
	const byTool = new Map<string, number>();
	const denyRules = new Map<string, number>();
	let overrides = 0;
	let crashes = 0;
	for (const e of inWeek) {
		verdicts[e.verdict]++;
		byTool.set(e.tool, (byTool.get(e.tool) ?? 0) + 1);
		if (e.override) overrides++;
		if (e.crash) crashes++;
		if (e.verdict === "deny") {
			denyRules.set(e.rule, (denyRules.get(e.rule) ?? 0) + 1);
		}
	}
	const topDenyRules = [...denyRules.entries()]
		.map(([rule, count]) => ({ rule, count }))
		.sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule))
		.slice(0, MAX_DENY_RULES);
	return {
		week,
		total: inWeek.length,
		verdicts,
		denyRate: ratio(verdicts.deny, inWeek.length),
		askRate: ratio(verdicts.ask, inWeek.length),
		overrides,
		overrideRate: ratio(overrides, verdicts.deny + overrides),
		crashes,
		byTool: Object.fromEntries(byTool),
		topDenyRules,
	};
}
