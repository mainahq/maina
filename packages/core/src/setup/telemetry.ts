/**
 * Setup — Anonymous telemetry (sub-task 8 of #174).
 *
 * Fire-and-forget POST of a fully-anonymized setup event to the cloud for
 * the RL flywheel. The module is paranoid about two things:
 *
 *   1. Zero PII. The payload only carries enum-shaped detection data, timings,
 *      version strings, and a random setupId. No cwd, file paths, repo URL,
 *      user content, error stacks, or commit shas. Ever.
 *
 *   2. Zero effect on setup. Every failure mode — offline, proxy blocking,
 *      4xx/5xx, timeout — resolves with `{ sent: false, error }` and never
 *      throws. Telemetry must not block the wizard or change its exit code.
 *
 * Opt-out precedence (highest first):
 *   1. `--no-telemetry` flag → `options.telemetry === false`
 *   2. `MAINA_TELEMETRY` env (`0|false|no|off` → out; `1|true|yes|on|""unset""` → in)
 *   3. `.maina/config.json: { telemetry: false }`
 *   4. default: opted in
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { StackContext } from "./context";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SetupTelemetryStack {
	languages: string[];
	frameworks: string[];
	packageManager: string;
	linters: string[];
	testRunners: string[];
	repoSize: { files: number; bytes: number };
	isLarge: boolean;
	isEmpty: boolean;
}

export interface SetupTelemetryPhase {
	phase: string;
	status: string;
	durationMs?: number;
}

export interface SetupTelemetryEvent {
	/** SHA-256(deviceFingerprint + Date.now() + random) truncated to 32 hex. */
	setupId: string;
	stack: SetupTelemetryStack;
	durationMs: number;
	phases: SetupTelemetryPhase[];
	aiSource: "host" | "cloud" | "byok" | "degraded";
	tailored: boolean;
	degraded: boolean;
	mainaVersion: string;
	mode: "fresh" | "update" | "reset";
	ci: boolean;
}

export interface SendTelemetryOptions {
	cwd: string;
	event: SetupTelemetryEvent;
	fetchImpl?: typeof fetch;
	/** Base URL for the cloud API. Default: https://api.mainahq.com */
	cloudUrl?: string;
	/** Cap on the POST round-trip. Default: 1000ms. */
	timeoutMs?: number;
	userAgent: string;
}

export interface TelemetryOptOutSources {
	env?: NodeJS.ProcessEnv;
	/** Absolute path to `.maina/config.json`. */
	configPath?: string;
	/**
	 * Value of `options.telemetry`. `false` indicates `--no-telemetry` was
	 * passed. `true` / `undefined` means the flag was not set explicitly.
	 */
	flag?: boolean;
}

export interface OptOutResult {
	optedOut: boolean;
	reason: "flag" | "env" | "config" | null;
}

const DEFAULT_CLOUD_URL = "https://api.mainahq.com";
const DEFAULT_TIMEOUT_MS = 1000;

// ── Opt-out resolution ──────────────────────────────────────────────────────

function envOptOutValue(raw: string | undefined): boolean | null {
	if (raw === undefined) return null;
	const v = raw.trim().toLowerCase();
	if (v === "") return null;
	if (v === "0" || v === "false" || v === "no" || v === "off") return true;
	if (v === "1" || v === "true" || v === "yes" || v === "on") return false;
	// Anything else — treat as unset to avoid surprising users.
	return null;
}

function configOptOut(configPath: string | undefined): boolean | null {
	if (!configPath) return null;
	try {
		const raw = readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw) as { telemetry?: unknown };
		if (parsed && typeof parsed === "object" && "telemetry" in parsed) {
			if (parsed.telemetry === false) return true;
			if (parsed.telemetry === true) return false;
		}
		return null;
	} catch {
		// Missing / malformed config — treat as unset (default: opted in).
		return null;
	}
}

/**
 * Resolve the user's telemetry preference.
 *
 * Precedence (highest first): flag > env > config > default(opted in).
 * Returns the *source* of the opt-out decision so callers can log a reason
 * if desired. Opted-in returns `{ optedOut: false, reason: null }`.
 */
export function isTelemetryOptedOut(
	opts: TelemetryOptOutSources,
): OptOutResult {
	// 1. Flag — only `--no-telemetry` (explicit false) counts as opt-out.
	if (opts.flag === false) {
		return { optedOut: true, reason: "flag" };
	}

	// 2. Env — MAINA_TELEMETRY wins over config.
	const envOut = envOptOutValue(opts.env?.MAINA_TELEMETRY);
	if (envOut === true) return { optedOut: true, reason: "env" };
	if (envOut === false) return { optedOut: false, reason: null };

	// 3. Config file.
	const cfgOut = configOptOut(opts.configPath);
	if (cfgOut === true) return { optedOut: true, reason: "config" };

	// 4. Default — opted in.
	return { optedOut: false, reason: null };
}

// ── Anonymization ───────────────────────────────────────────────────────────

/**
 * Strip a `StackContext` down to enum-shaped fields. Explicitly drops
 * `subprojects`, `buildTool` (may leak uncommon private tooling), and `cicd`
 * (narrow identifiers can reveal the hosting provider but not the repo).
 *
 * NB: we keep `cicd` out of the telemetry shape per spec (only fields
 * enumerated in sub-task 8 are in the payload). Tests assert this.
 */
export function anonymizeStack(ctx: StackContext): SetupTelemetryStack {
	return {
		languages: [...ctx.languages].sort(),
		frameworks: [...ctx.frameworks].sort(),
		packageManager: ctx.packageManager,
		linters: [...ctx.linters].sort(),
		testRunners: [...ctx.testRunners].sort(),
		repoSize: { files: ctx.repoSize.files, bytes: ctx.repoSize.bytes },
		isLarge: ctx.isLarge,
		isEmpty: ctx.isEmpty,
	};
}

/**
 * Generate an anonymous setup identifier.
 *
 * SHA-256(fingerprint|timestamp|random) truncated to 32 hex chars (128 bits).
 * The fingerprint input is already one-way hashed upstream, so this is a
 * second layer of randomisation that prevents joining two setup events from
 * the same device without server-side correlation (which we do not attempt).
 */
export function newSetupId(fingerprint: string): string {
	const salt = randomBytes(16).toString("hex");
	const blob = `${fingerprint}|${Date.now()}|${salt}`;
	return createHash("sha256").update(blob).digest("hex").slice(0, 32);
}

// ── Network: fire-and-forget POST ───────────────────────────────────────────

/**
 * POST the event to `${cloudUrl}/v1/setup/telemetry`. Never throws.
 *
 * Caps the round-trip at `timeoutMs` (default 1s). Any non-2xx is treated
 * as a failure. The body is JSON-serialised directly — callers must build an
 * event with only the keys declared in `SetupTelemetryEvent`.
 */
export async function sendSetupTelemetry(
	opts: SendTelemetryOptions,
): Promise<{ sent: boolean; error: string | null }> {
	const cloudUrl = opts.cloudUrl ?? DEFAULT_CLOUD_URL;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const fetchImpl = opts.fetchImpl ?? fetch;

	const url = `${cloudUrl.replace(/\/+$/, "")}/v1/setup/telemetry`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetchImpl(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": opts.userAgent,
			},
			body: JSON.stringify(opts.event),
			signal: controller.signal,
		});
		if (!res.ok) {
			return { sent: false, error: `http_${res.status}` };
		}
		return { sent: true, error: null };
	} catch (e) {
		if (e instanceof Error && e.name === "AbortError") {
			return { sent: false, error: "timeout" };
		}
		return {
			sent: false,
			error: e instanceof Error ? e.message.slice(0, 120) : "unknown",
		};
	} finally {
		clearTimeout(timer);
	}
}
