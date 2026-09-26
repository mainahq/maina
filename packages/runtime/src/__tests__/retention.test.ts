/**
 * What a hook run adds to the local retention history (FR-RET-7): a
 * session start the user began or came back to, and a notification shown.
 */

import { describe, expect, test } from "bun:test";
import type { SessionEvent } from "../adapters/claude-code";
import { retentionEventsOf } from "../retention";

const NOW = 1_780_000_000_000;

const start = (source?: string): SessionEvent => ({
	kind: "session.start",
	sessionId: "s-1",
	cwd: "/repo",
	...(source === undefined ? {} : { source }),
});

const session = (event: SessionEvent) => ({ type: "session" as const, event });

describe("retentionEventsOf", () => {
	test("a session start is a session, labelled with the host", () => {
		expect(
			retentionEventsOf(session(start("startup")), false, "claude-code", NOW),
		).toEqual([{ kind: "session", ts: NOW, host: "claude-code" }]);
		expect(retentionEventsOf(session(start()), false, "cursor", NOW)).toEqual([
			{ kind: "session", ts: NOW, host: "cursor" },
		]);
	});

	test("a resumed session counts; a clear or a compaction does not", () => {
		expect(
			retentionEventsOf(session(start("resume")), false, "claude-code", NOW),
		).toHaveLength(1);
		for (const source of ["clear", "compact"]) {
			expect(
				retentionEventsOf(session(start(source)), false, "claude-code", NOW),
			).toEqual([]);
		}
	});

	test("a stop is not a session", () => {
		const stop: SessionEvent = { kind: "session.stop", sessionId: "s-1" };
		expect(retentionEventsOf(session(stop), false, "codex", NOW)).toEqual([]);
	});

	test("a notification shown is a surface", () => {
		expect(
			retentionEventsOf({ type: "gate" }, true, "claude-code", NOW),
		).toEqual([{ kind: "surface", ts: NOW, surface: "notification" }]);
		expect(
			retentionEventsOf({ type: "gate" }, false, "claude-code", NOW),
		).toEqual([]);
	});
});
