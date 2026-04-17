/**
 * Cloud Error Reporter — extends OSS reporter with account-linked metadata.
 *
 * Default-on for Cloud users. Opt-out via user settings.
 * Events tagged with user_id, org_id, plan_tier — never email or name.
 * Uses Result<T, E> pattern.
 */

import type { Result } from "../db/index";
import type { ErrorEvent, ErrorEventContext } from "./reporter";
import { buildErrorEvent } from "./reporter";

// ── Types ──────────────────────────────────────────────────────────────

export interface CloudErrorContext {
	userId: string;
	orgId: string;
	planTier: "free" | "team" | "enterprise";
	/** User has opted out of error reporting */
	optedOut?: boolean;
}

export interface CloudErrorEvent extends ErrorEvent {
	userId: string;
	orgId: string;
	planTier: string;
}

// ── Consent ────────────────────────────────────────────────────────────

/**
 * Check if cloud error reporting is enabled.
 * Default: true (opt-out model). Returns false if user has opted out.
 */
export function isCloudReportingEnabled(
	cloudContext: CloudErrorContext,
): boolean {
	return !cloudContext.optedOut;
}

// ── Event Building ─────────────────────────────────────────────────────

/**
 * Build a cloud error event with account metadata.
 * Extends the base error event with user_id, org_id, plan_tier.
 * Never includes email or name.
 */
export function buildCloudErrorEvent(
	error: Error,
	context: ErrorEventContext,
	cloudContext: CloudErrorContext,
): CloudErrorEvent {
	const baseEvent = buildErrorEvent(error, context);

	return {
		...baseEvent,
		userId: cloudContext.userId,
		orgId: cloudContext.orgId,
		planTier: cloudContext.planTier,
	};
}

/**
 * Build and return a cloud error event, respecting opt-out.
 * Returns Result with null value if reporting is disabled.
 */
export function reportCloudError(
	error: Error,
	context: ErrorEventContext,
	cloudContext: CloudErrorContext,
): Result<CloudErrorEvent | null> {
	if (!isCloudReportingEnabled(cloudContext)) {
		return { ok: true, value: null };
	}

	try {
		const event = buildCloudErrorEvent(error, context, cloudContext);
		return { ok: true, value: event };
	} catch (e) {
		return {
			ok: false,
			error: `Failed to build cloud error event: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}
