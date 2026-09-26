/**
 * The GitHub App behind the remote connector's PR jobs (FR-REM-2).
 *
 * Two ports keep the jobs testable against a fake GitHub: `AppCredentials`
 * mints the App's JWT (`privateKeyCredentials` signs it with the App's
 * private key) and `GitHubApi` is the handful of REST calls a job makes
 * (`restGitHubApi` over any `fetch`). Neither throws: GitHub's error
 * statuses and network failures come back as `GitHubError`.
 *
 * Read-only by default: the App is registered (`appManifest`) and its
 * installation tokens are requested (`installationToken`) with
 * `READ_ONLY_PERMISSIONS` unless the caller names wider ones. A job only
 * reads the repository and its pull requests.
 */

import { createPrivateKey, createSign } from "node:crypto";
import type { Result } from "@mainahq/core";

type Permission = "read" | "write";

/** GitHub App permissions by name, e.g. `{ contents: "read" }`. */
export type Permissions = Readonly<Record<string, Permission>>;

/** What a PR job needs: the code, the pull request, repository metadata. */
export const READ_ONLY_PERMISSIONS = {
	contents: "read",
	metadata: "read",
	pull_requests: "read",
} as const satisfies Permissions;

export type GitHubError = Readonly<{
	kind: "github";
	/** The HTTP status GitHub answered; `null` when no answer arrived. */
	status: number | null;
	message: string;
}>;

/** Mints the App's JWT, which authenticates it to ask for installation tokens. */
export type AppCredentials = Readonly<{
	appJwt: () => Promise<Result<string, GitHubError>>;
}>;

export type RepoRef = Readonly<{ owner: string; name: string }>;

type InstallationToken = Readonly<{
	token: string;
	expiresAt: string;
	permissions: Permissions;
}>;

export type PullRequest = Readonly<{
	number: number;
	headSha: string;
	baseSha: string;
	/** The base repository's clone URL; a fork's head is fetched from it by sha. */
	cloneUrl: string;
}>;

export type ChangedFile = Readonly<{
	path: string;
	/** GitHub's file status: added, modified, removed, renamed, ... */
	status: string;
}>;

type PullCall = Readonly<{
	token: string;
	repository: RepoRef;
	number: number;
}>;

export type GitHubApi = Readonly<{
	/** An installation token for one repository with `permissions` (default read-only). */
	installationToken: (
		call: Readonly<{
			appJwt: string;
			installationId: number;
			repository: RepoRef;
			permissions?: Permissions;
		}>,
	) => Promise<Result<InstallationToken, GitHubError>>;
	pullRequest: (call: PullCall) => Promise<Result<PullRequest, GitHubError>>;
	/** Every file the pull request changes, across pages. */
	pullRequestFiles: (
		call: PullCall,
	) => Promise<Result<readonly ChangedFile[], GitHubError>>;
	/** Ends an installation token before it expires. */
	revokeToken: (token: string) => Promise<Result<void, GitHubError>>;
}>;

const githubError = (
	status: number | null,
	message: string,
): Result<never, GitHubError> => ({
	ok: false,
	error: { kind: "github", status, message },
});

const errorText = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// ── Credentials ─────────────────────────────────────────────────────────────

const b64url = (text: string): string =>
	Buffer.from(text, "utf8").toString("base64url");

/**
 * Credentials from the App's id and PEM private key (PKCS#1 as GitHub
 * issues it, or PKCS#8). The JWT is backdated a minute against clock drift
 * and lives nine more, inside GitHub's ten-minute limit.
 */
export function privateKeyCredentials(
	options: Readonly<{ appId: string; privateKey: string; now: () => number }>,
): AppCredentials {
	return {
		appJwt: async () => {
			try {
				const key = createPrivateKey(options.privateKey);
				const iat = Math.floor(options.now() / 1000) - 60;
				const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
				const claims = b64url(
					JSON.stringify({ iat, exp: iat + 600, iss: options.appId }),
				);
				const signature = createSign("RSA-SHA256")
					.update(`${header}.${claims}`)
					.sign(key)
					.toString("base64url");
				return { ok: true, value: `${header}.${claims}.${signature}` };
			} catch (e) {
				return githubError(null, `cannot sign the App JWT: ${errorText(e)}`);
			}
		},
	};
}

// ── REST adapter ────────────────────────────────────────────────────────────

type Fetch = (req: Request) => Promise<Response>;

const PER_PAGE = 100;
/** GitHub lists at most 3000 files for a pull request. */
const MAX_PAGES = 30;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
	typeof v === "string" ? v : undefined;

const repoPath = (r: RepoRef): string =>
	`/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;

function parsePull(body: unknown): PullRequest | undefined {
	if (!isRecord(body) || !isRecord(body.head) || !isRecord(body.base)) {
		return undefined;
	}
	const repo = body.base.repo;
	const number = body.number;
	const headSha = str(body.head.sha);
	const baseSha = str(body.base.sha);
	const cloneUrl = isRecord(repo) ? str(repo.clone_url) : undefined;
	if (
		typeof number !== "number" ||
		headSha === undefined ||
		baseSha === undefined ||
		cloneUrl === undefined
	) {
		return undefined;
	}
	return { number, headSha, baseSha, cloneUrl };
}

function parseFiles(body: unknown): readonly ChangedFile[] | undefined {
	if (!Array.isArray(body)) return undefined;
	const files: ChangedFile[] = [];
	for (const item of body) {
		const path = isRecord(item) ? str(item.filename) : undefined;
		const status = isRecord(item) ? str(item.status) : undefined;
		if (path === undefined || status === undefined) return undefined;
		files.push({ path, status });
	}
	return files;
}

function parseToken(body: unknown): InstallationToken | undefined {
	if (!isRecord(body)) return undefined;
	const token = str(body.token);
	const expiresAt = str(body.expires_at);
	if (token === undefined || expiresAt === undefined) return undefined;
	const permissions: Record<string, Permission> = {};
	if (isRecord(body.permissions)) {
		for (const [name, level] of Object.entries(body.permissions)) {
			if (level === "read" || level === "write") permissions[name] = level;
		}
	}
	return { token, expiresAt, permissions };
}

/** The GitHub REST API (`baseUrl` defaults to github.com's) over `fetch`. */
export function restGitHubApi(
	options: Readonly<{ fetch: Fetch; baseUrl?: string }>,
): GitHubApi {
	const baseUrl = (options.baseUrl ?? "https://api.github.com").replace(
		/\/+$/,
		"",
	);

	async function call(
		method: string,
		path: string,
		bearer: string,
		body?: unknown,
	): Promise<Result<unknown, GitHubError>> {
		let res: Response;
		try {
			res = await options.fetch(
				new Request(`${baseUrl}${path}`, {
					method,
					headers: {
						accept: "application/vnd.github+json",
						authorization: `Bearer ${bearer}`,
						"x-github-api-version": "2022-11-28",
						"user-agent": "maina-remote",
						...(body !== undefined
							? { "content-type": "application/json" }
							: {}),
					},
					...(body !== undefined ? { body: JSON.stringify(body) } : {}),
				}),
			);
		} catch (e) {
			return githubError(null, errorText(e));
		}
		if (res.status === 204) return { ok: true, value: undefined };
		const parsed: unknown = await res.json().catch(() => undefined);
		if (!res.ok) {
			const message = isRecord(parsed) ? str(parsed.message) : undefined;
			return githubError(res.status, message ?? res.statusText);
		}
		return { ok: true, value: parsed };
	}

	const decoded = <T>(
		result: Result<unknown, GitHubError>,
		parse: (body: unknown) => T | undefined,
		what: string,
	): Result<T, GitHubError> => {
		if (!result.ok) return result;
		const value = parse(result.value);
		return value === undefined
			? githubError(null, `unexpected ${what} response from GitHub`)
			: { ok: true, value };
	};

	return {
		installationToken: async ({
			appJwt,
			installationId,
			repository,
			permissions,
		}) =>
			decoded(
				await call(
					"POST",
					`/app/installations/${encodeURIComponent(String(installationId))}/access_tokens`,
					appJwt,
					{
						repositories: [repository.name],
						permissions: permissions ?? READ_ONLY_PERMISSIONS,
					},
				),
				parseToken,
				"installation token",
			),

		pullRequest: async ({ token, repository, number }) =>
			decoded(
				await call("GET", `${repoPath(repository)}/pulls/${number}`, token),
				parsePull,
				"pull request",
			),

		pullRequestFiles: async ({ token, repository, number }) => {
			const files: ChangedFile[] = [];
			for (let page = 1; page <= MAX_PAGES; page += 1) {
				const batch = decoded(
					await call(
						"GET",
						`${repoPath(repository)}/pulls/${number}/files?per_page=${PER_PAGE}&page=${page}`,
						token,
					),
					parseFiles,
					"pull request files",
				);
				if (!batch.ok) return batch;
				files.push(...batch.value);
				if (batch.value.length === 0) break;
			}
			return { ok: true, value: files };
		},

		revokeToken: async (token) => {
			const result = await call("DELETE", "/installation/token", token);
			return result.ok ? { ok: true, value: undefined } : result;
		},
	};
}

// ── Registration ────────────────────────────────────────────────────────────

type AppManifest = Readonly<{
	name: string;
	url: string;
	hook_attributes: Readonly<{ url: string; active: boolean }>;
	public: boolean;
	default_permissions: Permissions;
	default_events: readonly string[];
}>;

/**
 * The manifest for registering the App (GitHub's "create a GitHub App from
 * a manifest" flow): private, read-only, subscribed to pull request events.
 */
export function appManifest(
	options: Readonly<{ name: string; url: string; webhookUrl: string }>,
): AppManifest {
	return {
		name: options.name,
		url: options.url,
		hook_attributes: { url: options.webhookUrl, active: true },
		public: false,
		default_permissions: READ_ONLY_PERMISSIONS,
		default_events: ["pull_request"],
	};
}
