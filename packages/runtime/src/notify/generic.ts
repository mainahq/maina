/**
 * The generic terminal notification (FR-RET-6, #351). Pure.
 *
 * OSC 9 (iTerm2, WezTerm, Windows Terminal) carries a body only, so the
 * title leads it; OSC 777 (Ghostty) carries both. Either ends with BEL.
 *
 * The text comes from gate reasons and verify summaries, which can quote
 * what an agent asked to run, so it is untrusted: `sanitize` strips every
 * control character (a stray ESC or BEL would end the sequence and start
 * another) and replaces `;`, which ends an OSC field.
 */

import type { GenericOsc } from "./detect";

/** What a notification says. */
export type Notification = Readonly<{ title: string; body: string }>;

const ESC = "\u001b";
const BEL = "\u0007";

/** Longest text a notification carries; the rest is cut. */
const MAX_TEXT = 200;

/** `text` safe inside one OSC field: one line, no control characters. */
export function sanitize(text: string, max: number = MAX_TEXT): string {
	const clean = text
		.replace(/[\t\n\r]+/g, " ")
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
		.replace(/;/g, ",")
		.replace(/ {2,}/g, " ")
		.trim();
	// By code point, so a cut never splits a surrogate pair.
	const chars = Array.from(clean);
	return chars.length <= max ? clean : `${chars.slice(0, max - 1).join("")}…`;
}

/** An OSC 777 desktop notification. */
export function osc777(notification: Notification): string {
	return `${ESC}]777;notify;${sanitize(notification.title)};${sanitize(notification.body)}${BEL}`;
}

export function genericSequence(
	osc: GenericOsc,
	notification: Notification,
): string {
	if (osc === "777") return osc777(notification);
	const text = sanitize(`${notification.title}: ${notification.body}`);
	return `${ESC}]9;${text}${BEL}`;
}
