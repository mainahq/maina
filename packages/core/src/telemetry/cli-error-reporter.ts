/**
 * CLI crash reporter — anonymous crash reports, opt-in only (FR-PRIV-1).
 *
 * Nothing is sent unless the effective collection config opts in to
 * `crash_reports` (the user policy `telemetry.crash_reports: true`, or the
 * legacy `errors: true` in `~/.maina/config.yml`). Kill switches
 * (`DO_NOT_TRACK=1`, `MAINA_TELEMETRY=0`, `~/.maina/telemetry.json`
 * `{ "optOut": true }`) beat any opt-in. See `./consent`.
 *
 * Payload matches the server validator at maina-cloud `POST /v1/cli/errors`.
 * All string fields are scrubbed (paths → basenames, secrets → [REDACTED], etc.)
 * defensively; the server scrubs again.
 *
 * The send goes through the injected network port: 1s timeout, all errors
 * swallowed, never blocks the crash path. Callers print the original error to
 * the user BEFORE calling this.
 */

import { createHash, randomUUID } from "node:crypto";
import { basename, win32 as winPath } from "node:path";
import type { EnvPort } from "../ports/env";
import type { NetworkPort } from "../ports/network";
import { isChannelEnabled, type TelemetryContext } from "./consent";
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

export interface PayloadOptions {
	mainaVersion: string;
	command?: string;
	argv?: string[];
	/** Environment for `CI`. */
	env: EnvPort;
}

export type SendOptions = PayloadOptions &
	TelemetryContext & {
		/** Every byte sent goes through this port. */
		network: NetworkPort;
		/** Overrides `MAINA_CLOUD_URL` and the default endpoint. */
		baseUrl?: string;
		timeoutMs?: number;
	};

// ── Payload ────────────────────────────────────────────────────────────────

/**
 * Best-effort derivation of the command name from argv.
 *
 * Stops at the first flag so a call like `maina commit -m "secret msg"` is
 * reported as `"commit"`, not `"commit secret"` — option VALUES must never
 * leak into telemetry.
 */
function deriveCommand(argv: string[]): string {
	const positional: string[] = [];
	for (const arg of argv.slice(2)) {
		if (arg.startsWith("-")) break;
		positional.push(arg);
	}
	return positional.slice(0, 2).join(" ") || "(unknown)";
}

/**
 * Unix roots whose contents are always filesystem paths (and never valid
 * API-route or URL-path tokens). Anything else is left alone to avoid
 * mangling strings like `/v1/cli/errors`.
 */
const UNIX_FILESYSTEM_ROOT =
	/^\/(?:tmp|var|opt|etc|usr|bin|sbin|lib|srv|run|mnt|proc|sys|private|Volumes|dev|root)(?:\/|$)/;

/**
 * Rewrite any absolute-looking path tokens to basenames. Runs AFTER the
 * existing scrubber which already handles `/Users/`, `/home/`, `C:\\Users\\`.
 * This catches unusual roots (`/tmp`, `/opt`, `/var`, etc.).
 */
function pathsToBasenames(text: string): string {
	return text.replace(
		/(?:\/[A-Za-z0-9_.-][^\s:()"'<>]*|[A-Z]:\\[A-Za-z0-9_.-][^\s:()"'<>]*)/g,
		(match, offset: number, source: string) => {
			// Leave already-scrubbed markers alone, including repo-relative
			// segments where the existing scrubber produced `<repo>/path/...`:
			// the inner regex matches `/path/...` which doesn't contain `<repo>`.
			if (match.includes("<repo>") || match.includes("<redacted")) return match;
			if (source.slice(Math.max(0, offset - 6), offset) === "<repo>") {
				return match;
			}

			const isWindowsPath = /^[A-Z]:\\/.test(match);
			const isUnixFilesystemPath = UNIX_FILESYSTEM_ROOT.test(match);

			// Only rewrite tokens that look like real filesystem paths. Leaves
			// API routes (`/v1/cli/errors`), URLs (`http://...` — already skipped
			// by leading slash check), and other slash-delimited non-paths alone.
			if (!isWindowsPath && !isUnixFilesystemPath) return match;

			// Secondary guard against short non-path tokens like `5/10`.
			const hasExtension = /\.[A-Za-z]{1,10}$/.test(match);
			const hasTwoSeparators = /[/\\].+[/\\]/.test(match);
			if (!hasExtension && !hasTwoSeparators) return match;

			return isWindowsPath ? winPath.basename(match) : basename(match);
		},
	);
}

export function buildCliErrorPayload(
	error: unknown,
	opts: PayloadOptions,
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
		ci: !!opts.env.get("CI"),
	};
}

// ── Transport ───────────────────────────────────────────────────────────────

/**
 * Send a CLI error report to the cloud when crash reports are opted in.
 * Resolves whether or not the POST succeeded, never rejects, never blocks
 * longer than `timeoutMs` (the network adapter enforces it).
 */
export async function sendCliErrorReport(
	error: unknown,
	opts: SendOptions,
): Promise<void> {
	try {
		if (!(await isChannelEnabled(opts, "crash_reports"))) return;
		const payload = buildCliErrorPayload(error, opts);
		const baseUrl =
			opts.baseUrl ??
			opts.env.get("MAINA_CLOUD_URL") ??
			"https://api.mainahq.com";
		await opts.network.post({
			url: `${baseUrl}/v1/cli/errors`,
			body: JSON.stringify(payload),
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			timeoutMs: opts.timeoutMs ?? 1000,
		});
	} catch {
		// Never let telemetry amplify the crash.
	}
}
