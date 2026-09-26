/**
 * The shareable digest card (FR-RET-5): a few plain-text lines a developer
 * can paste anywhere.
 *
 *   Maina · week 2026-39
 *   12 agent actions checked: 4 blocked, 4 asked, 4 allowed
 *   2 overrides · 1 crash
 *   Most blocked: gate.self_override (2)
 *   mainahq.com
 *
 * By default the card carries numbers and Maina's own vocabulary only: the
 * week key and built-in action class ids. Tool names and rule text can name
 * files, commands or repositories, so they stay out unless the caller asks
 * for them (`includeLabels`).
 */

import { ACTION_CLASS_IDS } from "../policy/defaults";
import type { WeeklyDigest } from "./build";

export type CardOptions = Readonly<{
	/** Also show the top tool names and deny rules as logged. */
	includeLabels?: boolean;
}>;

const CATALOG: ReadonlySet<string> = new Set(ACTION_CLASS_IDS);
const TOP_LABELS = 3;

const plural = (n: number, one: string, many: string): string =>
	`${n} ${n === 1 ? one : many}`;

/** The first built-in action class named in a rule, if any. */
function catalogClass(rule: string): string | undefined {
	return rule.split(/[^a-z0-9_.]+/).find((word) => CATALOG.has(word));
}

/** Deny counts per built-in action class, most frequent first. */
function blockedClasses(
	digest: WeeklyDigest,
): ReadonlyArray<readonly [string, number]> {
	const counts = new Map<string, number>();
	for (const { rule, count } of digest.topDenyRules) {
		const cls = catalogClass(rule);
		if (cls !== undefined) counts.set(cls, (counts.get(cls) ?? 0) + count);
	}
	return [...counts.entries()].sort(
		(a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
	);
}

/** A logged label on one line. */
const oneLine = (label: string): string =>
	label.replace(/\p{Cc}+/gu, " ").trim();

function labelLines(digest: WeeklyDigest): readonly string[] {
	const tools = Object.entries(digest.byTool)
		.sort((a, b) => b[1] - a[1])
		.slice(0, TOP_LABELS)
		.map(([tool, n]) => `${oneLine(tool)} (${n})`);
	const rules = digest.topDenyRules
		.slice(0, TOP_LABELS)
		.map(({ rule, count }) => `${oneLine(rule)} (${count})`);
	return [
		...(tools.length > 0 ? [`Top tools: ${tools.join(", ")}`] : []),
		...(rules.length > 0 ? [`Top deny rules: ${rules.join(", ")}`] : []),
	];
}

/** The card for `digest`, without a trailing newline. */
export function renderDigestCard(
	digest: WeeklyDigest,
	options: CardOptions = {},
): string {
	const { verdicts } = digest;
	const [top] = blockedClasses(digest);
	return [
		`Maina · week ${digest.week}`,
		`${plural(digest.total, "agent action", "agent actions")} checked: ${verdicts.deny} blocked, ${verdicts.ask} asked, ${verdicts.allow} allowed`,
		`${plural(digest.overrides, "override", "overrides")} · ${plural(digest.crashes, "crash", "crashes")}`,
		...(top === undefined ? [] : [`Most blocked: ${top[0]} (${top[1]})`]),
		...(options.includeLabels === true ? labelLines(digest) : []),
		"mainahq.com",
	].join("\n");
}
