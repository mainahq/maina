/**
 * Warp's notification (FR-RET-6, #351). Pure.
 *
 * Warp documents one way for a program to raise a desktop notification:
 * the OSC 777 `notify` sequence, title then body
 * (https://docs.warp.dev/terminal/more-features/notifications/). That is
 * the only thing maina sends Warp. Warp's structured agent channel is the
 * private protocol of Warp's own agent plugins, versioned and gated by
 * build, and maina does not depend on it (ADR 0049).
 */

import { type Notification, osc777 } from "./generic";

export function warpSequence(notification: Notification): string {
	return osc777(notification);
}
