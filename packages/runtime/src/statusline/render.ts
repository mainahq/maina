/**
 * Agent status line render (FR-RET-1, #347).
 *
 * One line for the host's status bar, at most `STATUSLINE_MAX_WIDTH` visible
 * characters, with the session's live numbers:
 *
 *   Maina: on · 1 blocked · 2 asked · 14 allowed · 5 routed ~$0.42 saved · +38ms p95
 *   Maina: degraded (gate) · no decisions yet
 *   Maina: off
 *
 * Pure and deterministic: the same state always renders the same line. A
 * line that would be too wide drops its trailing parts whole, so a number is
 * never cut. Only numbers and fixed words reach the line, never host text.
 */

import type { DegradedPart, StatuslineState } from "./state";

export const STATUSLINE_MAX_WIDTH = 80;

type RenderOptions = Readonly<{
	/** Colour the state word with ANSI codes; they add no visible width. */
	color?: boolean;
}>;

const SEPARATOR = " · ";
const ELLIPSIS = "…";

const ESC = "\x1b";
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;

/** Characters a terminal shows: ANSI colour codes count for nothing. */
export function visibleWidth(line: string): number {
	return [...line.replace(ANSI, "")].length;
}

/** A count as a whole, non-negative number: 0 for anything else. */
function count(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function head(
	state: StatuslineState,
	degraded: readonly DegradedPart[],
): Readonly<{ text: string; color: string }> {
	if (state.runtime === "off") return { text: "off", color: DIM };
	if (degraded.length > 0) {
		return { text: `degraded (${degraded.join(", ")})`, color: YELLOW };
	}
	return { text: "on", color: GREEN };
}

function routingPart(routed: number, savedUsd: number): string | undefined {
	if (routed === 0) return undefined;
	const cents = Number.isFinite(savedUsd)
		? Math.round(Math.abs(savedUsd) * 100)
		: 0;
	if (cents === 0) return `${routed} routed`;
	const label = savedUsd > 0 ? "saved" : "extra";
	return `${routed} routed ~$${(cents / 100).toFixed(2)} ${label}`;
}

/** The parts after the head, most important first. */
function parts(state: StatuslineState): readonly string[] {
	if (state.runtime === "off") return [];
	const { summary } = state;
	if (summary === null) return ["no decisions yet"];
	const latency = summary.addedLatencyP95;
	return [
		`${count(summary.blocked)} blocked`,
		`${count(summary.asked)} asked`,
		`${count(summary.allowed)} allowed`,
		routingPart(count(summary.routed), summary.estimatedSavedUsd),
		latency !== null && Number.isFinite(latency) && latency >= 0
			? `+${Math.round(latency)}ms p95`
			: undefined,
	].filter((p): p is string => p !== undefined);
}

/** `text` cut to `width` characters, the last one an ellipsis. */
function clip(text: string, width: number): string {
	const chars = [...text];
	return chars.length <= width
		? text
		: `${chars.slice(0, Math.max(0, width - 1)).join("")}${ELLIPSIS}`;
}

/** The status line for `state`. */
export function renderStatusline(
	state: StatuslineState,
	options: RenderOptions = {},
): string {
	const degraded = state.runtime === "on" ? state.degraded : [];
	const label = head(state, degraded);
	const prefix = "Maina: ";
	const budget = STATUSLINE_MAX_WIDTH - prefix.length;
	const headText = clip(label.text, budget);
	let used = [...headText].length;
	let body = "";
	for (const part of parts(state)) {
		const next = SEPARATOR.length + [...part].length;
		if (used + next > budget) break;
		body += `${SEPARATOR}${part}`;
		used += next;
	}
	const lead = `${prefix}${headText}`;
	return options.color
		? `${label.color}${lead}${RESET}${body}`
		: `${lead}${body}`;
}
