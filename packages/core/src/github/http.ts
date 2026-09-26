/**
 * The HTTP edge the GitHub surfaces talk through, and the GitHub REST call
 * built on it. Core builds every request (URL, headers, JSON body) and
 * parses every response; the adapter only moves bytes. Adapters never throw:
 * failures come back as `Result`.
 */

import type { Result } from "../db/index";
import type { NetworkError } from "../ports/network";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type HttpRequest = Readonly<{
	method: HttpMethod;
	url: string;
	headers: Readonly<Record<string, string>>;
	/** Already-serialised JSON, absent for GET and DELETE. */
	body?: string;
	/** Hard cap on the round trip; the adapter aborts past it. */
	timeoutMs: number;
}>;

/** Any HTTP status comes back as a value; only transport failures are errors. */
export type HttpResponse = Readonly<{ status: number; body: string }>;

export type HttpPort = Readonly<{
	request: (
		request: HttpRequest,
	) => Promise<Result<HttpResponse, NetworkError>>;
}>;

/**
 * What the publish may do with GitHub. `readOnly` is known up front on a
 * fork PR, where the workflow token cannot write to the base repository.
 */
export type GitHubAuth = Readonly<{
	token: string;
	readOnly: boolean;
	/** REST base, for GitHub Enterprise Server. Default `https://api.github.com`. */
	apiUrl?: string;
}>;

export type GitHubError =
	| Readonly<{ kind: "forbidden"; status: number; message: string }>
	| Readonly<{ kind: "api"; status: number; message: string }>
	| Readonly<{ kind: "bad_response"; message: string }>
	| NetworkError;

const DEFAULT_API_URL = "https://api.github.com";
const TIMEOUT_MS = 10_000;

/** One GitHub REST call; 2xx parses as JSON (an empty body is `null`). */
export async function githubRequest(
	http: HttpPort,
	auth: GitHubAuth,
	method: HttpMethod,
	path: string,
	payload?: unknown,
): Promise<Result<unknown, GitHubError>> {
	const base = (auth.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
	const response = await http.request({
		method,
		url: `${base}${path}`,
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${auth.token}`,
			"user-agent": "maina",
			"x-github-api-version": "2022-11-28",
			...(payload === undefined ? {} : { "content-type": "application/json" }),
		},
		...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
		timeoutMs: TIMEOUT_MS,
	});
	if (!response.ok) return response;
	const { status, body } = response.value;
	if (status < 200 || status >= 300) {
		const message = messageOf(body) ?? `HTTP ${status}`;
		// 403 ("Resource not accessible by integration") is the read-only token.
		const error: GitHubError =
			status === 403
				? { kind: "forbidden", status, message }
				: { kind: "api", status, message };
		return { ok: false, error };
	}
	if (body.trim() === "") return { ok: true, value: null };
	try {
		return { ok: true, value: JSON.parse(body) as unknown };
	} catch {
		return {
			ok: false,
			error: { kind: "bad_response", message: `${method} ${path}: not JSON` },
		};
	}
}

function messageOf(body: string): string | undefined {
	try {
		const parsed = JSON.parse(body) as { message?: unknown } | null;
		return typeof parsed?.message === "string" ? parsed.message : undefined;
	} catch {
		return undefined;
	}
}

/** `owner/name`, as GitHub allows the two segments. */
export function isRepoSlug(repo: string): boolean {
	return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}
