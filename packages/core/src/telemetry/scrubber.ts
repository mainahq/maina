/**
 * PII Scrubber — removes personally identifiable information and code content
 * from error events before network send.
 *
 * Pure functions. No side effects. Runs client-side only.
 */

// ── Pattern definitions ─────────────────────────────────────────────────

/** Matches absolute file paths: /Users/name/..., C:\Users\..., /home/name/... */
const ABS_PATH_PATTERN =
	/(?:\/Users\/\w+|\/home\/\w+|[A-Z]:\\Users\\\w+)[^\s:,)}\]'"]*/g;

/** Matches email addresses */
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Matches IPv4 addresses (not localhost) */
const IPV4_PATTERN =
	/\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;

/** Matches common API key/token patterns */
const SECRET_PATTERNS = [
	/\b(sk-[a-zA-Z0-9]{20,})\b/g, // OpenAI
	/\b(ghp_[a-zA-Z0-9]{36,})\b/g, // GitHub PAT
	/\b(gho_[a-zA-Z0-9]{36,})\b/g, // GitHub OAuth
	/\b(glpat-[a-zA-Z0-9-]{20,})\b/g, // GitLab PAT
	/\b(xoxb-[a-zA-Z0-9-]{20,})\b/g, // Slack bot
	/\b(Bearer\s+[a-zA-Z0-9._~+/=-]{20,})\b/g, // Bearer tokens
	/\b([a-zA-Z0-9]{32,})\b/g, // Generic long hex/alphanum (aggressive — 32+ chars)
];

/** Matches env variable values in KEY=VALUE format */
const ENV_VALUE_PATTERN = /\b([A-Z_]{2,})\s*=\s*["']?([^"'\s;]+)["']?/g;

// ── Scrubber functions ──────────────────────────────────────────────────

/**
 * Replace absolute file paths with repo-relative paths.
 * /Users/bikash/code/maina/src/index.ts → <repo>/src/index.ts
 */
export function scrubFilePaths(text: string): string {
	return text.replace(ABS_PATH_PATTERN, (match) => {
		// Find common repo markers to extract relative path
		for (const marker of ["/src/", "/packages/", "/node_modules/", "/dist/"]) {
			const idx = match.indexOf(marker);
			if (idx !== -1) {
				return `<repo>${match.slice(idx)}`;
			}
		}
		return "<redacted-path>";
	});
}

/**
 * Replace API keys, tokens, and secrets with [REDACTED].
 */
export function scrubSecrets(text: string): string {
	let result = text;
	for (const pattern of SECRET_PATTERNS) {
		// Reset regex state
		pattern.lastIndex = 0;
		result = result.replace(pattern, "[REDACTED]");
	}
	return result;
}

/**
 * Replace emails and IP addresses.
 */
export function scrubPersonalInfo(text: string): string {
	return text.replace(EMAIL_PATTERN, "[EMAIL]").replace(IPV4_PATTERN, "[IP]");
}

/**
 * Replace environment variable values with just the key name.
 * OPENROUTER_API_KEY="sk-abc123" → OPENROUTER_API_KEY=[REDACTED]
 */
export function scrubEnvValues(text: string): string {
	return text.replace(ENV_VALUE_PATTERN, "$1=[REDACTED]");
}

/**
 * Scrub code content from stack trace frames.
 * Keeps: file path (scrubbed), line number, function name.
 * Removes: code snippets, column content.
 */
export function scrubStackTrace(stack: string): string {
	const lines = stack.split("\n");
	return lines
		.map((line) => {
			let scrubbed = scrubFilePaths(line);
			scrubbed = scrubSecrets(scrubbed);
			scrubbed = scrubPersonalInfo(scrubbed);
			return scrubbed;
		})
		.join("\n");
}

/**
 * Combined PII scrubber. Applies all scrubbing passes in order.
 * Safe to call on any text — worst case, some text gets [REDACTED].
 */
export function scrubPii(text: string): string {
	let result = text;
	result = scrubFilePaths(result);
	result = scrubSecrets(result);
	result = scrubPersonalInfo(result);
	result = scrubEnvValues(result);
	return result;
}

/**
 * Scrub a full error event object for PostHog/telemetry.
 */
export function scrubErrorEvent(event: {
	message?: string;
	stack?: string;
	[key: string]: unknown;
}): Record<string, unknown> {
	const scrubbed: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(event)) {
		if (typeof value === "string") {
			if (key === "stack") {
				scrubbed[key] = scrubStackTrace(value);
			} else {
				scrubbed[key] = scrubPii(value);
			}
		} else {
			scrubbed[key] = value;
		}
	}

	return scrubbed;
}
