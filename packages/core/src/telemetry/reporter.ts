/**
 * Error Reporter — scrubs and formats error events for telemetry.
 *
 * Consent-gated: zero events produced until user opts in.
 * Uses the PII scrubber for all string fields before formatting.
 * Events are plain objects — the actual send is handled by the caller
 * (PostHog client or HTTP POST).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateErrorId } from "../errors/error-id";
import { scrubErrorEvent, scrubPii } from "./scrubber";

// ── Types ──────────────────────────────────────────────────────────────

export interface ErrorEventContext {
	/** CLI command that was running (e.g. "verify", "commit") */
	command?: string;
	/** Maina version */
	version?: string;
	/** Host agent (claude-code, cursor, copilot, windsurf, none) */
	agent?: string;
}

export interface ErrorEvent {
	/** Event name for PostHog */
	event: "maina.error";
	/** Error class name */
	errorClass: string;
	/** Scrubbed error message */
	message: string;
	/** Scrubbed stack trace */
	stack: string;
	/** Short error ID for user reference */
	errorId: string;
	/** OS platform */
	os: string;
	/** Runtime (bun/node) */
	runtime: string;
	/** Maina version */
	version: string;
	/** Command that was running */
	command: string;
	/** Agent identifier */
	agent: string;
	/** Timestamp */
	timestamp: string;
}

// ── Config ─────────────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), ".maina", "config.yml");

/**
 * Check if error reporting is enabled.
 * Reads `errors: true` from `~/.maina/config.yml`.
 * Returns false if config doesn't exist or doesn't contain the opt-in.
 */
export function isErrorReportingEnabled(): boolean {
	try {
		if (!existsSync(CONFIG_PATH)) return false;
		const content = readFileSync(CONFIG_PATH, "utf-8");
		// Simple YAML check: errors: true
		return /^errors:\s*true$/m.test(content);
	} catch {
		return false;
	}
}

// ── Event Building ─────────────────────────────────────────────────────

/**
 * Build a scrubbed error event from an Error object.
 * Always scrubs — even if reporting is disabled, this is safe to call.
 */
export function buildErrorEvent(
	error: Error,
	context: ErrorEventContext = {},
): ErrorEvent {
	const scrubbed = scrubErrorEvent({
		message: error.message,
		stack: error.stack ?? "",
	});

	return {
		event: "maina.error",
		errorClass: error.constructor.name,
		message: scrubbed.message as string,
		stack: scrubbed.stack as string,
		errorId: generateErrorId(error),
		os: process.platform,
		runtime: typeof Bun !== "undefined" ? "bun" : "node",
		version: context.version ?? "unknown",
		command: context.command ?? "unknown",
		agent: context.agent ?? detectAgent(),
		timestamp: new Date().toISOString(),
	};
}

/**
 * Build and return an error event, respecting consent.
 * Returns null if error reporting is disabled.
 */
export function reportError(
	error: Error,
	context: ErrorEventContext = {},
): ErrorEvent | null {
	if (!isErrorReportingEnabled()) return null;
	return buildErrorEvent(error, context);
}

// ── Agent Detection ────────────────────────────────────────────────────

function detectAgent(): string {
	if (process.env.CLAUDECODE === "1" || process.env.CLAUDE_CODE_ENTRYPOINT) {
		return "claude-code";
	}
	if (process.env.CURSOR === "1") return "cursor";
	if (process.env.WINDSURF === "1") return "windsurf";
	if (process.env.CODEX === "1") return "codex";
	return "none";
}
