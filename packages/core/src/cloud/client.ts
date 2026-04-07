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
	CloudEpisodicEntry,
	CloudFeedbackPayload,
	CloudPromptImprovement,
	EpisodicCloudEntry,
	FeedbackEvent,
	FeedbackImprovementsResponse,
	ProfileUpdatePayload,
	ProfileUpdateResponse,
	PromptRecord,
	SubmitVerifyPayload,
	TeamInfo,
	TeamMember,
	VerifyResultResponse,
	VerifyStatusResponse,
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

	/** Update user profile (email, name) during onboarding. */
	updateProfile(
		payload: ProfileUpdatePayload,
	): Promise<Result<ProfileUpdateResponse, string>>;

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

	/** Upload a batch of feedback events to the cloud. */
	postFeedbackBatch(
		events: FeedbackEvent[],
	): Promise<Result<{ received: number }, string>>;

	/** Fetch feedback-based improvement suggestions from the cloud. */
	getFeedbackImprovements(): Promise<
		Result<FeedbackImprovementsResponse, string>
	>;

	/** Post workflow stats to cloud analytics. */
	postWorkflowStats(stats: {
		totalCommits: number;
		totalVerifyTimeMs: number;
		avgVerifyTimeMs: number;
		totalFindings: number;
		totalContextTokens: number;
		cacheHitRate: number;
		passRate: number;
	}): Promise<Result<{ received: boolean }, string>>;

	/** Upload episodic entries to the cloud for team sharing. */
	postEpisodicEntries(
		entries: EpisodicCloudEntry[],
	): Promise<Result<{ received: number }, string>>;

	/** Fetch team's episodic entries for a repo from the cloud. */
	getEpisodicEntries(
		repo: string,
	): Promise<Result<CloudEpisodicEntry[], string>>;

	/** Submit a diff for cloud verification. */
	submitVerify(
		payload: SubmitVerifyPayload,
	): Promise<Result<{ jobId: string }, string>>;

	/** Poll the status of a verification job. */
	getVerifyStatus(jobId: string): Promise<Result<VerifyStatusResponse, string>>;

	/** Retrieve the full result of a completed verification job. */
	getVerifyResult(jobId: string): Promise<Result<VerifyResultResponse, string>>;
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

		updateProfile: async (payload) => {
			// biome-ignore lint/suspicious/noExplicitAny: snake_case API mapping
			const result = await request<any>("PATCH", "/auth/profile", payload);
			if (!result.ok) return result;
			const d = result.value;
			return ok({
				email: d.email,
				name: d.name,
				isOnboarded: d.isOnboarded ?? d.is_onboarded ?? false,
			});
		},

		getPrompts: () => request<PromptRecord[]>("GET", "/prompts"),

		putPrompts: (prompts) => request<void>("PUT", "/prompts", { prompts }),

		getTeam: () => request<TeamInfo>("GET", "/team"),

		getTeamMembers: () => request<TeamMember[]>("GET", "/team/members"),

		inviteTeamMember: (email, role = "member") =>
			request<{ invited: boolean }>("POST", "/team/invite", { email, role }),

		postFeedback: (payload) =>
			request<{ recorded: boolean }>("POST", "/feedback", payload),

		postFeedbackBatch: async (events) => {
			// Map camelCase → snake_case for cloud API
			const snakeEvents = events.map((e) => ({
				prompt_hash: e.promptHash,
				command: e.command,
				accepted: e.accepted,
				context: e.context,
				diff_hash: e.diffHash,
				timestamp: e.timestamp,
			}));
			return request<{ received: number }>("POST", "/feedback/batch", {
				events: snakeEvents,
			});
		},

		getFeedbackImprovements: async () => {
			// biome-ignore lint/suspicious/noExplicitAny: snake_case API mapping
			const result = await request<any>("GET", "/feedback/improvements");
			if (!result.ok) return result;
			const d = result.value;
			const rawImprovements = d.improvements ?? [];
			const improvements: CloudPromptImprovement[] = rawImprovements.map(
				// biome-ignore lint/suspicious/noExplicitAny: snake_case API mapping
				(i: any) => ({
					command: i.command,
					promptHash: i.promptHash ?? i.prompt_hash,
					samples: i.samples,
					acceptRate: i.acceptRate ?? i.accept_rate,
					status: i.status,
				}),
			);
			const totals = d.teamTotals ?? d.team_totals ?? {};
			return ok({
				improvements,
				teamTotals: {
					totalEvents: totals.totalEvents ?? totals.total_events ?? 0,
					acceptRate: totals.acceptRate ?? totals.accept_rate ?? 0,
				},
			});
		},

		postEpisodicEntries: async (entries) => {
			// Map camelCase → snake_case for cloud API
			const snakeEntries = entries.map((e) => ({
				repo: e.repo,
				entry_type: e.entryType,
				title: e.title,
				summary: e.summary,
				relevance_score: e.relevanceScore,
			}));
			return request<{ received: number }>("POST", "/context/episodic", {
				entries: snakeEntries,
			});
		},

		getEpisodicEntries: async (repo) => {
			// biome-ignore lint/suspicious/noExplicitAny: snake_case API mapping
			const result = await request<any>(
				"GET",
				`/context/episodic?repo=${encodeURIComponent(repo)}`,
			);
			if (!result.ok) return result;
			const d = result.value;
			const rawEntries = d.entries ?? [];
			const mapped: CloudEpisodicEntry[] = rawEntries.map(
				// biome-ignore lint/suspicious/noExplicitAny: snake_case API mapping
				(e: any) => ({
					id: e.id,
					repo: e.repo,
					entryType: e.entryType ?? e.entry_type,
					title: e.title,
					summary: e.summary,
					relevanceScore: e.relevanceScore ?? e.relevance_score ?? 1.0,
					memberId: e.memberId ?? e.member_id,
					decayFactor: e.decayFactor ?? e.decay_factor ?? 1.0,
					createdAt: e.createdAt ?? e.created_at,
					accessedAt: e.accessedAt ?? e.accessed_at,
				}),
			);
			return ok(mapped);
		},

		postWorkflowStats: (stats) =>
			request<{ received: boolean }>("POST", "/feedback/stats", {
				total_commits: stats.totalCommits,
				total_verify_time_ms: stats.totalVerifyTimeMs,
				avg_verify_time_ms: stats.avgVerifyTimeMs,
				total_findings: stats.totalFindings,
				total_context_tokens: stats.totalContextTokens,
				cache_hit_rate: stats.cacheHitRate,
				pass_rate: stats.passRate,
			}),

		submitVerify: async (payload) => {
			// biome-ignore lint/suspicious/noExplicitAny: snake_case API mapping
			const result = await request<any>("POST", "/verify", {
				diff: payload.diff,
				repo: payload.repo,
				base_branch: payload.baseBranch,
			});
			if (!result.ok) return result;
			const d = result.value;
			return ok({ jobId: d.jobId ?? d.job_id });
		},

		getVerifyStatus: async (jobId) => {
			// biome-ignore lint/suspicious/noExplicitAny: snake_case API mapping
			const result = await request<any>("GET", `/verify/${jobId}/status`);
			if (!result.ok) return result;
			const d = result.value;
			return ok({
				status: d.status,
				currentStep: d.currentStep ?? d.current_step ?? d.step ?? "",
			});
		},

		getVerifyResult: async (jobId) => {
			// biome-ignore lint/suspicious/noExplicitAny: snake_case API mapping
			const result = await request<any>("GET", `/verify/${jobId}`);
			if (!result.ok) return result;
			const d = result.value;
			const items = d.findings?.items ?? d.findings ?? [];
			return ok({
				id: d.id,
				status: d.status,
				passed: d.passed,
				findings: items,
				findingsErrors:
					d.findingsErrors ?? d.findings_errors ?? d.findings?.errors ?? 0,
				findingsWarnings:
					d.findingsWarnings ??
					d.findings_warnings ??
					d.findings?.warnings ??
					0,
				proofKey: d.proofKey ?? d.proof_key ?? d.proof_url ?? null,
				durationMs: d.durationMs ?? d.duration_ms ?? 0,
			});
		},
	};
}
