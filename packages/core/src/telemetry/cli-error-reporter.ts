/**
 * CLI crash reporter — fire-and-forget anonymous telemetry for CLI errors.
 *
 * Consent model is opt-OUT, mirroring the `cloud-reporter` posture.
 * User can opt out in three ways (any one suffices):
 *   - `~/.maina/telemetry.json` with `{ "optOut": true }`
 *   - `MAINA_TELEMETRY=0`
 *   - `DO_NOT_TRACK=1`
 *
 * Payload matches the server validator at maina-cloud `POST /v1/cli/errors`.
 * All string fields are scrubbed (paths → basenames, secrets → [REDACTED], etc.)
 * defensively; the server scrubs again.
 *
 * The send is fire-and-forget: 1s timeout, all errors swallowed, never blocks
 * the crash path. Callers print the original error to the user BEFORE calling
 * this.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { scrubPii, scrubStackTrace } from "./scrubber";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CliErrorPayload {
	errorId: string;
	command: string;
	errorClass: string;
	errorMessage: string;
	errorStack: string;
	mainaVersion: string;
	nodeVersion: string;
	platform: string;
	arch: string;
	ci: boolean;
}

export interface SendOptions {
	mainaVersion: string;
	command?: string;
	argv?: string[];
	baseUrl?: string;
	timeoutMs?: number;
}

// ── Consent ─────────────────────────────────────────────────────────────────

function telemetryConfigPath(): string {
	// Honour $HOME first so tests (and container users overriding $HOME) work;
	// fall back to the OS-reported home directory.
	return join(process.env.HOME ?? homedir(), ".maina", "telemetry.json");
}

/**
 * Returns true when the user has opted out of CLI telemetry.
 * Any one of env var, DO_NOT_TRACK, or file flag is sufficient.
 */
export function isCliTelemetryOptedOut(): boolean {
	if (process.env.MAINA_TELEMETRY === "0") return true;
	if (process.env.DO_NOT_TRACK === "1") return true;

	try {
		const path = telemetryConfigPath();
		if (!existsSync(path)) return false;
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as { optOut?: boolean };
		return parsed.optOut === true;
	} catch {
		return false;
	}
}

// ── Payload ────────────────────────────────────────────────────────────────

/**
 * Best-effort derivation of the command name from argv.
 * `bun /path/to/cli.js sync pull --flag` → `"sync pull"`.
 */
function deriveCommand(argv: string[]): string {
	const positional = argv.slice(2).filter((a) => !a.startsWith("-"));
	return positional.slice(0, 2).join(" ") || "(unknown)";
}

/**
 * Rewrite any absolute-looking path tokens to basenames. Runs AFTER the
 * existing scrubber which already handles `/Users/`, `/home/`, `C:\\Users\\`.
 * This catches unusual roots (`/tmp`, `/opt`, `/var`, etc.).
 */
function pathsToBasenames(text: string): string {
	return text.replace(
		/(?:\/[A-Za-z0-9_.-][^\s:()"'<>]*|[A-Z]:\\[A-Za-z0-9_.-][^\s:()"'<>]*)/g,
		(match) => {
			// Leave already-scrubbed markers alone
			if (match.includes("<repo>") || match.includes("<redacted")) return match;
			// Only rewrite tokens that actually look like paths: either ending in
			// a file extension, or containing two or more separators. This avoids
			// mangling fractions like `5/10` in error messages.
			const hasExtension = /\.[A-Za-z]{1,10}$/.test(match);
			const hasTwoSeparators = /[/\\].+[/\\]/.test(match);
			if (!hasExtension && !hasTwoSeparators) return match;
			return basename(match);
		},
	);
}

export function buildCliErrorPayload(
	error: unknown,
	opts: SendOptions,
): CliErrorPayload {
	const errObj =
		error instanceof Error ? error : new Error(String(error ?? "unknown"));

	const errorId = createHash("sha256")
		.update(`${process.pid}:${process.hrtime.bigint()}:${randomUUID()}`)
		.digest("hex")
		.slice(0, 32);

	const command = opts.command ?? deriveCommand(opts.argv ?? process.argv);
	const message = pathsToBasenames(scrubPii(errObj.message ?? ""));
	const stack = pathsToBasenames(scrubStackTrace(errObj.stack ?? ""));

	return {
		errorId,
		command,
		errorClass: errObj.constructor.name,
		errorMessage: message,
		errorStack: stack,
		mainaVersion: opts.mainaVersion,
		nodeVersion: process.version,
		platform: process.platform,
		arch: process.arch,
		ci: !!process.env.CI,
	};
}

// ── Transport ───────────────────────────────────────────────────────────────

/**
 * Send a CLI error report to the cloud. Fire-and-forget: resolves whether or
 * not the POST succeeded, never throws, never blocks longer than `timeoutMs`.
 */
export async function sendCliErrorReport(
	error: unknown,
	opts: SendOptions,
): Promise<void> {
	if (isCliTelemetryOptedOut()) return;

	const baseUrl =
		opts.baseUrl ?? process.env.MAINA_CLOUD_URL ?? "https://api.mainahq.com";
	const timeoutMs = opts.timeoutMs ?? 1000;

	let payload: CliErrorPayload;
	try {
		payload = buildCliErrorPayload(error, opts);
	} catch {
		return; // Never let telemetry amplify the crash
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		await fetch(`${baseUrl}/v1/cli/errors`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
	} catch {
		// Swallow network/timeout/abort — never block the crash path
	} finally {
		clearTimeout(timer);
	}
}
