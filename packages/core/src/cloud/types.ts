/**
 * Cloud client shared types.
 *
 * Used by the cloud HTTP client, auth module, and CLI commands
 * for syncing prompts, team management, and device-flow auth.
 */

// ── Configuration ───────────────────────────────────────────────────────────

export interface CloudConfig {
	/** Base URL of the maina cloud API (e.g. "https://api.maina.dev"). */
	baseUrl: string;
	/** Bearer token for authenticated requests. */
	token?: string;
	/** Request timeout in milliseconds. Default: 10_000. */
	timeoutMs?: number;
	/** Maximum retry attempts for transient failures. Default: 3. */
	maxRetries?: number;
}

// ── Prompts ─────────────────────────────────────────────────────────────────

export interface PromptRecord {
	/** Unique prompt identifier. */
	id: string;
	/** File path relative to .maina/prompts/ (e.g. "commit.md"). */
	path: string;
	/** Full prompt content (markdown). */
	content: string;
	/** SHA-256 hash of the content for change detection. */
	hash: string;
	/** ISO-8601 timestamp of last modification. */
	updatedAt: string;
}

// ── Team ────────────────────────────────────────────────────────────────────

export interface TeamInfo {
	/** Team identifier. */
	id: string;
	/** Display name. */
	name: string;
	/** Current billing plan. */
	plan: string;
	/** Number of seats used / total. */
	seats: { used: number; total: number };
}

export interface TeamMember {
	/** User email. */
	email: string;
	/** Role within the team. */
	role: "owner" | "admin" | "member";
	/** ISO-8601 join date. */
	joinedAt: string;
}

// ── Device-Code OAuth ───────────────────────────────────────────────────────

export interface DeviceCodeResponse {
	/** The code the user enters on the verification page. */
	userCode: string;
	/** The device code used to poll for token completion. */
	deviceCode: string;
	/** URL the user should visit. */
	verificationUri: string;
	/** Polling interval in seconds. */
	interval: number;
	/** Seconds until the device code expires. */
	expiresIn: number;
}

export interface TokenResponse {
	/** Bearer access token. */
	accessToken: string;
	/** Refresh token (if applicable). */
	refreshToken?: string;
	/** Seconds until the access token expires. */
	expiresIn: number;
}

// ── API Envelope ────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
	/** Response payload (present on success). */
	data?: T;
	/** Error message (present on failure). */
	error?: string;
	/** Optional metadata. */
	meta?: Record<string, unknown>;
}

// ── Feedback ────────────────────────────────────────────────────────────────

export interface CloudFeedbackPayload {
	/** Prompt hash the feedback refers to. */
	promptHash: string;
	/** Command that generated the output. */
	command: string;
	/** Whether the user accepted the output. */
	accepted: boolean;
	/** ISO-8601 timestamp. */
	timestamp: string;
	/** Optional context about the feedback. */
	context?: string;
}
