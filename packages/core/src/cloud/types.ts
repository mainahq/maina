/**
 * Cloud client shared types.
 *
 * Used by the cloud HTTP client, auth module, and CLI commands
 * for syncing prompts, team management, and device-flow auth.
 */

// ── Configuration ───────────────────────────────────────────────────────────

export interface CloudConfig {
	/** Base URL of the maina cloud API (e.g. "https://api.mainahq.com"). */
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

// ── Verify ─────────────────────────────────────────────────────────────────

export interface SubmitVerifyPayload {
	/** Diff content to verify. */
	diff: string;
	/** Repository identifier (e.g. "owner/repo"). */
	repo: string;
	/** Base branch to compare against. */
	baseBranch?: string;
}

export interface VerifyStatusResponse {
	/** Current job status. */
	status: "queued" | "running" | "done" | "failed";
	/** Human-readable description of the current step. */
	currentStep: string;
}

export interface VerifyFinding {
	/** Tool that produced the finding (e.g. "biome", "semgrep"). */
	tool: string;
	/** File path relative to repository root. */
	file: string;
	/** Line number in the file. */
	line: number;
	/** Finding description. */
	message: string;
	/** Severity level. */
	severity: "error" | "warning" | "info";
	/** Optional rule identifier. */
	ruleId?: string;
}

export interface VerifyResultResponse {
	/** Job identifier. */
	id: string;
	/** Final job status. */
	status: "done" | "failed";
	/** Whether all checks passed. */
	passed: boolean;
	/** Array of individual findings from verification tools. */
	findings: VerifyFinding[];
	/** Count of error-level findings. */
	findingsErrors: number;
	/** Count of warning-level findings. */
	findingsWarnings: number;
	/** Proof key for passing verification (null when failed). */
	proofKey: string | null;
	/** Total verification duration in milliseconds. */
	durationMs: number;
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
