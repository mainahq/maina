/**
 * Cloud HTTP client.
 *
 * Provides authenticated access to the maina cloud API for prompt sync,
 * team management, and feedback reporting. All methods return Result<T, string>.
 */

import type { Result } from "../db/index";
import type {
	ApiResponse,
	CloudConfig,
	CloudFeedbackPayload,
	PromptRecord,
	TeamInfo,
	TeamMember,
} from "./types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok<T>(value: T): Result<T, string> {
	return { ok: true, value };
}

function err(error: string): Result<never, string> {
	return { ok: false, error };
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

/** Status codes that trigger a retry. */
function isRetryable(status: number): boolean {
	return status === 429 || status >= 500;
}

/**
 * Sleep for the given number of milliseconds.
 * Extracted so tests can verify backoff behaviour.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Cloud Client ────────────────────────────────────────────────────────────

export interface CloudClient {
	/** Check API availability. */
	health(): Promise<Result<{ status: string }, string>>;

	/** Download team prompts. */
	getPrompts(): Promise<Result<PromptRecord[], string>>;

	/** Upload local prompts. */
	putPrompts(prompts: PromptRecord[]): Promise<Result<void, string>>;

	/** Fetch team information. */
	getTeam(): Promise<Result<TeamInfo, string>>;

	/** List team members. */
	getTeamMembers(): Promise<Result<TeamMember[], string>>;

	/** Invite a new member by email. */
	inviteTeamMember(
		email: string,
		role?: "admin" | "member",
	): Promise<Result<{ invited: boolean }, string>>;

	/** Report prompt feedback to the cloud. */
	postFeedback(
		payload: CloudFeedbackPayload,
	): Promise<Result<{ recorded: boolean }, string>>;
}

/**
 * Create a cloud API client.
 *
 * Every request attaches `Authorization: Bearer <token>` when a token is
 * present in the config. Transient failures (429, 5xx) are retried up to
 * `maxRetries` times with exponential backoff.
 */
export function createCloudClient(config: CloudConfig): CloudClient {
	const {
		baseUrl,
		token,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		maxRetries = DEFAULT_MAX_RETRIES,
	} = config;

	/** Build standard headers. */
	function headers(): Record<string, string> {
		const h: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json",
		};
		if (token) {
			h.Authorization = `Bearer ${token}`;
		}
		return h;
	}

	/** Make an HTTP request with retry + timeout. */
	async function request<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<Result<T, string>> {
		let lastError = "Unknown error";

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			if (attempt > 0) {
				const backoff = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
				await sleep(backoff);
			}

			try {
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), timeoutMs);

				const response = await fetch(`${baseUrl}${path}`, {
					method,
					headers: headers(),
					body: body ? JSON.stringify(body) : undefined,
					signal: controller.signal,
				});

				clearTimeout(timer);

				if (isRetryable(response.status) && attempt < maxRetries) {
					lastError = `HTTP ${response.status}`;
					continue;
				}

				if (!response.ok) {
					const text = await response.text();
					let message: string;
					try {
						const parsed = JSON.parse(text) as ApiResponse<unknown>;
						message = parsed.error ?? `HTTP ${response.status}`;
					} catch {
						message = text || `HTTP ${response.status}`;
					}
					return err(message);
				}

				// 204 No Content — return void-compatible
				if (response.status === 204) {
					return ok(undefined as unknown as T);
				}

				const json = (await response.json()) as ApiResponse<T>;
				if (json.error) {
					return err(json.error);
				}
				return ok(json.data as T);
			} catch (e) {
				if (
					e instanceof DOMException &&
					e.name === "AbortError" &&
					attempt < maxRetries
				) {
					lastError = "Request timed out";
					continue;
				}
				lastError = e instanceof Error ? e.message : String(e);
				// Transient network errors are retried via the outer loop
			}
		}

		return err(`Request failed after ${maxRetries + 1} attempts: ${lastError}`);
	}

	return {
		health: () => request<{ status: string }>("GET", "/health"),

		getPrompts: () => request<PromptRecord[]>("GET", "/prompts"),

		putPrompts: (prompts) => request<void>("PUT", "/prompts", { prompts }),

		getTeam: () => request<TeamInfo>("GET", "/team"),

		getTeamMembers: () => request<TeamMember[]>("GET", "/team/members"),

		inviteTeamMember: (email, role = "member") =>
			request<{ invited: boolean }>("POST", "/team/invite", { email, role }),

		postFeedback: (payload) =>
			request<{ recorded: boolean }>("POST", "/feedback", payload),
	};
}
