/**
 * Usage Telemetry — opt-in anonymous usage tracking.
 *
 * Separate from error reporting (#121). Gated on the `usage` channel of the
 * effective collection config (see `./consent`). Events are plain objects —
 * no PostHog SDK dependency.
 * Zero PII in any event.
 */

import { isChannelEnabled, type TelemetryContext } from "./consent";

// ── Event Types ────────────────────────────────────────────────────────

export type UsageEventName =
	| "maina.install"
	| "maina.verify.started"
	| "maina.verify.completed"
	| "maina.learn.ran"
	| "maina.commit"
	| "maina.plan"
	| "maina.wiki.init"
	| "maina.wiki.query";

export interface UsageEvent {
	event: UsageEventName;
	properties: Record<string, string | number | boolean>;
	timestamp: string;
	os: string;
	runtime: string;
	version: string;
}

// ── Config ─────────────────────────────────────────────────────────────

/**
 * Check if usage telemetry is enabled: the `usage` channel of the effective
 * collection config, read through the injected ports. Separate from error
 * reporting consent (`crash_reports`). False on any read or policy error.
 */
export function isTelemetryEnabled(ctx: TelemetryContext): Promise<boolean> {
	return isChannelEnabled(ctx, "usage");
}

// ── Event Building ─────────────────────────────────────────────────────

/**
 * Build a usage event. Always safe to call — no PII, no side effects.
 */
export function buildUsageEvent(
	name: UsageEventName,
	properties: Record<string, string | number | boolean> = {},
	version = "unknown",
): UsageEvent {
	return {
		event: name,
		properties,
		timestamp: new Date().toISOString(),
		os: process.platform,
		runtime: typeof Bun !== "undefined" ? "bun" : "node",
		version,
	};
}

/**
 * Build and return a usage event, respecting consent.
 * Resolves to null if telemetry is disabled.
 */
export async function trackUsageEvent(
	ctx: TelemetryContext,
	name: UsageEventName,
	properties: Record<string, string | number | boolean> = {},
	version = "unknown",
): Promise<UsageEvent | null> {
	if (!(await isTelemetryEnabled(ctx))) return null;
	return buildUsageEvent(name, properties, version);
}
