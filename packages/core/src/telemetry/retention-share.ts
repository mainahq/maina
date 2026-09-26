/**
 * Opt-in retention events (FR-RET-7, FR-PRIV-1). Retention is measured on
 * this machine (`stats/retention`); when, and only when, the user has opted
 * in to the `usage` channel, a summary can be shared: the day-7 and day-28
 * window statuses, the surface each window's first return is attributed to,
 * and the return-session count per surface.
 *
 * Never shared: timestamps, dates, hosts, session counts outside the
 * attribution, or anything from the log itself. The payload is re-validated
 * against that closed shape before it is sent.
 */

import type { Result } from "../db/index";
import type { NetworkError, NetworkPort } from "../ports/network";
import {
	ATTRIBUTIONS,
	type Attribution,
	type RetentionReport,
	type RetentionWindow,
	type WindowStatus,
} from "../stats/retention";
import { isChannelEnabled, type TelemetryContext } from "./consent";
import type { ShareResult } from "./outcome-share";

export const RETENTION_SHARE_VERSION = 1;

export type RetentionSharePayload = Readonly<{
	v: typeof RETENTION_SHARE_VERSION;
	day7: WindowStatus;
	/** The attribution of the window's first return; only when it returned. */
	day7Surface?: Attribution;
	day28: WindowStatus;
	day28Surface?: Attribution;
	attribution: Readonly<Record<Attribution, number>>;
}>;

export type RetentionShareError =
	| Readonly<{ kind: "invalid_payload"; field: string; message: string }>
	| Readonly<{ kind: "network"; error: NetworkError }>;

export type RetentionSharePorts = TelemetryContext &
	Readonly<{ network: NetworkPort }>;

export type RetentionShareOptions = Readonly<{
	baseUrl: string;
	timeoutMs?: number;
}>;

const STATUSES: readonly string[] = ["pending", "returned", "missed"];
const PAYLOAD_KEYS = new Set([
	"v",
	"day7",
	"day7Surface",
	"day28",
	"day28Surface",
	"attribution",
]);
const DEFAULT_TIMEOUT_MS = 2_000;

function invalid(
	field: string,
	message: string,
): Result<never, RetentionShareError> {
	return { ok: false, error: { kind: "invalid_payload", field, message } };
}

const isAttribution = (value: unknown): value is Attribution =>
	typeof value === "string" &&
	(ATTRIBUTIONS as readonly string[]).includes(value);

function validateAttribution(
	value: unknown,
): Result<Record<Attribution, number>, RetentionShareError> {
	if (typeof value !== "object" || value === null) {
		return invalid("attribution", "attribution must be an object");
	}
	const counts = value as Readonly<Record<string, unknown>>;
	const extra = Object.keys(counts).find((key) => !isAttribution(key));
	if (extra !== undefined) {
		return invalid(`attribution.${extra}`, "not a known surface");
	}
	const clean = {} as Record<Attribution, number>;
	for (const key of ATTRIBUTIONS) {
		const n = counts[key];
		if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) {
			return invalid(
				`attribution.${key}`,
				"count must be a non-negative integer",
			);
		}
		clean[key] = n;
	}
	return { ok: true, value: clean };
}

/** Checks `value` against the closed payload shape; returns a clean copy. */
export function validateRetentionSharePayload(
	value: unknown,
): Result<RetentionSharePayload, RetentionShareError> {
	if (typeof value !== "object" || value === null) {
		return invalid("payload", "payload must be an object");
	}
	const p = value as Readonly<Record<string, unknown>>;
	const extra = Object.keys(p).find((key) => !PAYLOAD_KEYS.has(key));
	if (extra !== undefined) {
		return invalid(extra, "field is not part of the payload");
	}
	if (p.v !== RETENTION_SHARE_VERSION) {
		return invalid("v", `v must be ${RETENTION_SHARE_VERSION}`);
	}
	for (const field of ["day7", "day28"] as const) {
		if (typeof p[field] !== "string" || !STATUSES.includes(p[field])) {
			return invalid(field, "must be pending, returned or missed");
		}
		const surface = p[`${field}Surface`];
		if (surface !== undefined && !isAttribution(surface)) {
			return invalid(`${field}Surface`, "not a known surface");
		}
	}
	const attribution = validateAttribution(p.attribution);
	if (!attribution.ok) return attribution;
	return {
		ok: true,
		value: {
			v: RETENTION_SHARE_VERSION,
			day7: p.day7 as WindowStatus,
			...(isAttribution(p.day7Surface) ? { day7Surface: p.day7Surface } : {}),
			day28: p.day28 as WindowStatus,
			...(isAttribution(p.day28Surface)
				? { day28Surface: p.day28Surface }
				: {}),
			attribution: attribution.value,
		},
	};
}

const firstSurface = (w: RetentionWindow): Attribution | undefined =>
	w.sessions[0]?.surface;

/** The shareable view of a retention report. */
export function buildRetentionSharePayload(
	report: RetentionReport,
): Result<RetentionSharePayload, RetentionShareError> {
	const day7Surface = firstSurface(report.day7);
	const day28Surface = firstSurface(report.day28);
	return validateRetentionSharePayload({
		v: RETENTION_SHARE_VERSION,
		day7: report.day7.status,
		...(day7Surface === undefined ? {} : { day7Surface }),
		day28: report.day28.status,
		...(day28Surface === undefined ? {} : { day28Surface }),
		attribution: report.attribution,
	});
}

/**
 * Shares the summary of `report` when, and only when, the effective config
 * opts in to `usage`. Otherwise (including any consent read error) nothing
 * touches the network and the result says it was skipped.
 */
export async function shareRetention(
	ports: RetentionSharePorts,
	report: RetentionReport | null,
	options: RetentionShareOptions,
): Promise<Result<ShareResult, RetentionShareError>> {
	if (!(await isChannelEnabled(ports, "usage"))) {
		return { ok: true, value: { sent: 0, skipped: "not_opted_in" } };
	}
	if (report === null) return { ok: true, value: { sent: 0 } };
	const payload = buildRetentionSharePayload(report);
	if (!payload.ok) return payload;
	const posted = await ports.network.post({
		url: `${options.baseUrl.replace(/\/+$/, "")}/v1/retention`,
		body: JSON.stringify(payload.value),
		headers: { "Content-Type": "application/json" },
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	});
	return posted.ok
		? { ok: true, value: { sent: 1 } }
		: { ok: false, error: { kind: "network", error: posted.error } };
}
