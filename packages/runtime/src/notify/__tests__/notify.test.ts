/**
 * Notifications (FR-RET-6, #351): `notify(event)` routes a gate prompt that
 * needs a human, and a finished verify, to the terminal's own notification:
 * Warp's documented OSC 777 desktop notification in Warp, OSC 9 or OSC 777
 * in the generic terminals that document one, and nothing anywhere else.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GateDecision } from "../../gate";
import { genericSequence, sanitize } from "../generic";
import {
	type NotifyEvent,
	notificationOf,
	notificationSequence,
	notify,
	notifyEventOf,
} from "../notify";
import { warpSequence } from "../warp";

const ESC = "\u001b";
const BEL = "\u0007";

const decision = (
	verdict: GateDecision["verdict"],
	reason: string,
): GateDecision => ({ verdict, reason, decisionIds: [], degraded: false });

const WARP = { TERM_PROGRAM: "WarpTerminal" };
const ITERM = { TERM_PROGRAM: "iTerm.app" };
const GHOSTTY = { TERM_PROGRAM: "ghostty" };

const ask: NotifyEvent = {
	type: "gate",
	decision: decision("ask", "rm -rf build needs confirmation"),
};
const verified: NotifyEvent = {
	type: "verify",
	decision: decision("allow", "maina verify: passed on 3 files"),
};

describe("notificationOf: only ask and verify completion", () => {
	test("a gate ask is a notification", () => {
		expect(notificationOf(ask)).toEqual({
			title: "maina needs your approval",
			body: "rm -rf build needs confirmation",
		});
	});

	test("a finished verify is a notification, pass or fail", () => {
		expect(notificationOf(verified)).toEqual({
			title: "maina verify finished",
			body: "maina verify: passed on 3 files",
		});
		expect(
			notificationOf({
				type: "verify",
				decision: decision("deny", "maina verify failed on changed lines"),
			}),
		).toEqual({
			title: "maina verify failed",
			body: "maina verify failed on changed lines",
		});
	});

	test("a gate allow or deny is not", () => {
		expect(
			notificationOf({ type: "gate", decision: decision("allow", "ok") }),
		).toBeNull();
		expect(
			notificationOf({ type: "gate", decision: decision("deny", "no") }),
		).toBeNull();
	});

	test("a stop that verified nothing is not", () => {
		expect(
			notificationOf({ type: "verify", decision: decision("allow", "") }),
		).toBeNull();
	});
});

describe("notifyEventOf: what a hook run notifies about", () => {
	test("a gated run notifies about its decision", () => {
		expect(notifyEventOf({ decision: decision("ask", "why") })).toEqual({
			type: "gate",
			decision: decision("ask", "why"),
		});
	});

	test("a stop notifies about its verify, even when verify blocked it", () => {
		const failed = decision("deny", "maina verify failed");
		expect(notifyEventOf({ decision: failed, verify: failed })).toEqual({
			type: "verify",
			decision: failed,
		});
	});

	test("a run with neither notifies about nothing", () => {
		expect(notifyEventOf({})).toBeUndefined();
	});
});

describe("notificationSequence: routed by terminal", () => {
	test("Warp gets its documented OSC 777 desktop notification", () => {
		expect(notificationSequence(ask, WARP)).toBe(
			`${ESC}]777;notify;maina needs your approval;rm -rf build needs confirmation${BEL}`,
		);
	});

	test("a generic OSC 9 terminal gets title and body in one line", () => {
		expect(notificationSequence(verified, ITERM)).toBe(
			`${ESC}]9;maina verify finished: maina verify: passed on 3 files${BEL}`,
		);
	});

	test("a generic OSC 777 terminal gets title and body apart", () => {
		expect(notificationSequence(verified, GHOSTTY)).toBe(
			`${ESC}]777;notify;maina verify finished;maina verify: passed on 3 files${BEL}`,
		);
	});

	test("nothing happens outside supported terminals", () => {
		expect(notificationSequence(ask, {})).toBeNull();
		expect(
			notificationSequence(ask, { TERM_PROGRAM: "Apple_Terminal" }),
		).toBeNull();
		expect(
			notificationSequence(ask, { ...WARP, TMUX: "/tmp/tmux" }),
		).toBeNull();
	});

	test("nothing happens for events that need no human", () => {
		expect(
			notificationSequence(
				{ type: "gate", decision: decision("allow", "ok") },
				WARP,
			),
		).toBeNull();
		expect(
			notificationSequence(
				{ type: "gate", decision: decision("deny", "no") },
				WARP,
			),
		).toBeNull();
		expect(notificationSequence(undefined, WARP)).toBeNull();
	});
});

describe("notify", () => {
	test("emits the sequence once, and says it did", () => {
		const emitted: string[] = [];
		expect(notify(ask, { env: WARP, emit: (seq) => emitted.push(seq) })).toBe(
			true,
		);
		expect(emitted).toEqual([
			`${ESC}]777;notify;maina needs your approval;rm -rf build needs confirmation${BEL}`,
		]);
	});

	test("emits nothing outside supported terminals or for other events", () => {
		const emitted: string[] = [];
		const emit = (seq: string) => emitted.push(seq);
		expect(notify(ask, { env: {}, emit })).toBe(false);
		expect(
			notify(
				{ type: "gate", decision: decision("allow", "ok") },
				{ env: WARP, emit },
			),
		).toBe(false);
		expect(emitted).toEqual([]);
	});

	test("an emit that throws never escapes", () => {
		expect(
			notify(ask, {
				env: WARP,
				emit: () => {
					throw new Error("no tty");
				},
			}),
		).toBe(false);
	});
});

describe("sanitize: the text is untrusted", () => {
	test("control characters never reach the terminal", () => {
		const body = sanitize(`evil${ESC}]52;c;aGk=${BEL}\r\nmore\u009b31m`);
		// biome-ignore lint/suspicious/noControlCharactersInRegex: asserting they are gone
		expect(body).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
		expect(body).toBe("evil]52,c,aGk= more31m");
	});

	test("a cut never splits a surrogate pair", () => {
		const out = sanitize("😀".repeat(300), 10);
		expect(Array.from(out)).toHaveLength(10);
		expect(out).toBe(`${"😀".repeat(9)}…`);
	});

	test("semicolons, which end an OSC field, are replaced", () => {
		expect(sanitize("a;b;c")).toBe("a,b,c");
	});

	test("long text is cut to fit a notification", () => {
		const out = sanitize("x".repeat(500));
		expect(out.length).toBeLessThanOrEqual(200);
		expect(out.endsWith("…")).toBe(true);
	});

	test("an injected reason cannot break out of the Warp sequence", () => {
		const seq = warpSequence({
			title: "maina needs your approval",
			body: `x${BEL}${ESC}]1337;File=evil${BEL}`,
		});
		// One OSC, one terminator: nothing after the body is a second sequence.
		expect(seq.split(ESC)).toHaveLength(2);
		expect(seq.split(BEL)).toHaveLength(2);
		expect(seq.endsWith(BEL)).toBe(true);
	});

	test("an injected reason cannot break out of a generic sequence", () => {
		const seq = genericSequence("9", {
			title: "t",
			body: `${BEL}${ESC}[2J`,
		});
		expect(seq.split(ESC)).toHaveLength(2);
		expect(seq.split(BEL)).toHaveLength(2);
	});
});

describe("no dependency on Warp internals", () => {
	const dir = join(import.meta.dir, "..");
	const sources = readdirSync(dir)
		.filter((name) => name.endsWith(".ts"))
		.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));

	test("the notifier's sources exist", () => {
		expect(sources.map((s) => s.name).sort()).toEqual([
			"detect.ts",
			"generic.ts",
			"notify.ts",
			"warp.ts",
		]);
	});

	test("no undocumented Warp channel, variable or package", () => {
		for (const { name, text } of sources) {
			// Warp's structured agent channel is its plugins' private protocol.
			expect(text, name).not.toContain("warp://");
			expect(text, name).not.toMatch(/WARP_[A-Z_]+/);
			expect(text, name).not.toMatch(/from\s+["'](?!\.)[^"']*warp/i);
		}
	});

	test("the Warp sequence is the documented OSC 777 notify form", () => {
		const seq = warpSequence({ title: "Deploy", body: "Success on prod" });
		// docs.warp.dev/terminal/more-features/notifications
		expect(seq).toBe(`${ESC}]777;notify;Deploy;Success on prod${BEL}`);
	});

	test("Warp's own agent variables change nothing", () => {
		expect(
			notificationSequence(ask, {
				...WARP,
				WARP_CLI_AGENT_PROTOCOL_VERSION: "1",
				WARP_CLIENT_VERSION: "v0.2026.09.20.08.00.stable_00",
			}),
		).toBe(notificationSequence(ask, WARP));
	});
});
