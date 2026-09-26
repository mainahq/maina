/**
 * What one hook run adds to the local retention history (FR-RET-7): a
 * session start the user began or came back to (not a `/clear` or a
 * compaction, which continue the same session), and a notification that
 * was shown. Pure; the hook processes record the events.
 */

import type { RetentionEvent } from "@mainahq/core";
import type { SessionEvent } from "./adapters/claude-code";

/** SessionStart sources that continue a session rather than start one. */
const CONTINUED: ReadonlySet<string> = new Set(["clear", "compact"]);

/** The part of a Claude Code, Cursor or Codex hook event this reads. */
type HookEventLike = Readonly<{ type: string; event?: unknown }>;

function isSessionStart(event: HookEventLike): event is Readonly<{
	type: "session";
	event: SessionEvent;
}> {
	if (event.type !== "session") return false;
	const session = event.event as SessionEvent | undefined;
	return (
		session?.kind === "session.start" &&
		(session.source === undefined || !CONTINUED.has(session.source))
	);
}

/** The retention events for a hook run on `host` at `now`. */
export function retentionEventsOf(
	event: HookEventLike,
	notified: boolean,
	host: string,
	now: number,
): readonly RetentionEvent[] {
	return [
		...(isSessionStart(event)
			? [{ kind: "session" as const, ts: now, host }]
			: []),
		...(notified
			? [
					{
						kind: "surface" as const,
						ts: now,
						surface: "notification" as const,
					},
				]
			: []),
	];
}
