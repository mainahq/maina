/**
 * OAuth device-flow authentication.
 *
 * Implements the device authorization grant (RFC 8628) for CLI login.
 * Tokens are stored at ~/.maina/auth.json.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Result } from "../db/index";
import type {
	DeviceCodeResponse,
	GitHubDeviceCodeResponse,
	GitHubExchangeResponse,
	GitHubTokenResponse,
	TokenResponse,
} from "./types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok<T>(value: T): Result<T, string> {
	return { ok: true, value };
}

function err(error: string): Result<never, string> {
	return { ok: false, error };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Auth Config Path ────────────────────────────────────────────────────────

export interface AuthConfig {
	/** Bearer access token. */
	accessToken: string;
	/** Refresh token (if available). */
	refreshToken?: string;
	/** ISO-8601 timestamp when the token expires. */
	expiresAt?: string;
}

/**
 * Return the path to the auth config file.
 * Uses `configDir` override for testing; defaults to `~/.maina/auth.json`.
 */
export function getAuthConfigPath(configDir?: string): string {
	const dir = configDir ?? join(homedir(), ".maina");
	return join(dir, "auth.json");
}

// ── Load / Save / Clear ─────────────────────────────────────────────────────

/**
 * Load saved auth config from disk.
 * Returns err if not logged in or the file is malformed.
 */
export function loadAuthConfig(configDir?: string): Result<AuthConfig, string> {
	const path = getAuthConfigPath(configDir);
	if (!existsSync(path)) {
		return err("Not logged in. Run `maina login` first.");
	}

	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as AuthConfig;
		if (!parsed.accessToken) {
			return err("Auth config is missing accessToken.");
		}
		return ok(parsed);
	} catch (e) {
		return err(
			`Failed to read auth config: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

/**
 * Persist auth config to disk.
 */
export function saveAuthConfig(
	config: AuthConfig,
	configDir?: string,
): Result<void, string> {
	const path = getAuthConfigPath(configDir);

	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
		return ok(undefined);
	} catch (e) {
		return err(
			`Failed to save auth config: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

/**
 * Remove auth config from disk (logout).
 */
export function clearAuthConfig(configDir?: string): Result<void, string> {
	const path = getAuthConfigPath(configDir);
	if (!existsSync(path)) {
		return ok(undefined);
	}

	try {
		unlinkSync(path);
		return ok(undefined);
	} catch (e) {
		return err(
			`Failed to clear auth config: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

// ── Device Flow ─────────────────────────────────────────────────────────────

/**
 * Initiate the device authorization flow.
 *
 * Calls `POST /auth/device` on the cloud API to obtain a user code and
 * verification URI.
 */
export async function startDeviceFlow(
	baseUrl: string,
): Promise<Result<DeviceCodeResponse, string>> {
	try {
		const response = await fetch(`${baseUrl}/auth/device`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			const text = await response.text();
			return err(
				`Device flow initiation failed (HTTP ${response.status}): ${text}`,
			);
		}

		const body = (await response.json()) as {
			data?: Record<string, unknown>;
			error?: string;
		};
		if (body.error) {
			return err(body.error);
		}
		if (!body.data) {
			return err("Invalid response: missing data");
		}
		const d = body.data;
		return ok({
			userCode: (d.userCode ?? d.user_code) as string,
			deviceCode: (d.deviceCode ?? d.device_code) as string,
			verificationUri: (d.verificationUri ?? d.verification_uri) as string,
			interval: (d.interval ?? 5) as number,
			expiresIn: (d.expiresIn ?? d.expires_in ?? 900) as number,
		});
	} catch (e) {
		return err(
			`Device flow request failed: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

/**
 * Poll the cloud API until the user completes the device flow or the code
 * expires.
 *
 * Respects the `interval` returned by the server. Returns the token
 * response on success.
 */
export async function pollForToken(
	baseUrl: string,
	deviceCode: string,
	interval: number,
	expiresIn: number,
): Promise<Result<TokenResponse, string>> {
	const deadline = Date.now() + expiresIn * 1000;
	const pollInterval = Math.max(interval, 5) * 1000;

	while (Date.now() < deadline) {
		await sleep(pollInterval);

		try {
			const response = await fetch(`${baseUrl}/auth/token`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					device_code: deviceCode,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				}),
			});

			if (response.status === 428 || response.status === 400) {
				// "authorization_pending" — the user hasn't completed login yet
				continue;
			}

			if (!response.ok) {
				const text = await response.text();
				return err(`Token request failed (HTTP ${response.status}): ${text}`);
			}

			const body = (await response.json()) as {
				data?: Record<string, unknown>;
				error?: string;
			};
			if (body.error) {
				// "slow_down" → increase interval
				if (body.error === "slow_down") {
					continue;
				}
				return err(body.error);
			}
			if (!body.data) {
				return err("Invalid token response: missing data");
			}
			const d = body.data;
			return ok({
				accessToken: (d.accessToken ?? d.access_token) as string,
				refreshToken: (d.refreshToken ?? d.refresh_token) as string | undefined,
				expiresIn: (d.expiresIn ?? d.expires_in ?? 0) as number,
				firstTime: (d.firstTime ?? d.first_time ?? false) as boolean,
			});
		} catch (e) {
			// Network errors during polling are transient — keep trying
			if (Date.now() >= deadline) {
				return err(
					`Token polling failed: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		}
	}

	return err("Device code expired. Please try logging in again.");
}

// ── GitHub Device Flow ──────────────────────────────────────────────────────

/**
 * GitHub OAuth App client id used for CLI device flow.
 * Public value; OAuth apps have no client secret for the device flow.
 */
export const GITHUB_CLIENT_ID = "Iv23liUKmzMG4WYZITEk";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

export interface StartGitHubFlowOptions {
	/** Override the client id (for tests or alternate apps). */
	clientId?: string;
	/** Scopes to request. Defaults to "read:user". */
	scope?: string;
}

/**
 * Initiate the GitHub device authorization flow.
 *
 * See https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-cli-with-a-github-app
 */
export async function startGitHubDeviceFlow(
	opts: StartGitHubFlowOptions = {},
): Promise<Result<GitHubDeviceCodeResponse, string>> {
	const clientId = opts.clientId ?? GITHUB_CLIENT_ID;
	const scope = opts.scope ?? "read:user";

	try {
		const response = await fetch(GITHUB_DEVICE_CODE_URL, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({ client_id: clientId, scope }).toString(),
		});

		if (!response.ok) {
			const text = await response.text();
			return err(
				`GitHub device code request failed (HTTP ${response.status}): ${text}`,
			);
		}

		const body = (await response.json()) as Record<string, unknown>;

		if (body.error === "device_flow_disabled") {
			return err(
				"GitHub Device Flow is not enabled for this OAuth app. Ask an admin to enable it in the app's settings.",
			);
		}
		if (typeof body.error === "string") {
			return err(`GitHub device flow rejected: ${body.error}`);
		}

		const userCode = body.user_code;
		const deviceCode = body.device_code;
		const verificationUri = body.verification_uri;
		if (
			typeof userCode !== "string" ||
			typeof deviceCode !== "string" ||
			typeof verificationUri !== "string"
		) {
			return err("GitHub returned a malformed device code response.");
		}

		return ok({
			userCode,
			deviceCode,
			verificationUri,
			interval: typeof body.interval === "number" ? body.interval : 5,
			expiresIn: typeof body.expires_in === "number" ? body.expires_in : 900,
		});
	} catch (e) {
		return err(
			`GitHub device code request failed: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

export interface PollGitHubTokenOptions {
	/** Override the client id (for tests). */
	clientId?: string;
	/** Device code returned from `startGitHubDeviceFlow`. */
	deviceCode: string;
	/** Initial polling interval (seconds). */
	interval: number;
	/** Seconds until the device code expires. */
	expiresIn: number;
	/**
	 * Milliseconds to add to the polling interval when GitHub returns
	 * `slow_down`. Defaults to 5000 (GitHub's recommended minimum).
	 * Tests can lower this to keep runs fast.
	 */
	slowDownIncreaseMs?: number;
}

/**
 * Poll GitHub for an access token once the user completes the device flow.
 *
 * Respects the documented error responses:
 *   authorization_pending → keep polling
 *   slow_down             → increase interval by 5s, keep polling
 *   expired_token         → abort
 *   access_denied         → abort
 */
export async function pollGitHubToken(
	opts: PollGitHubTokenOptions,
): Promise<Result<GitHubTokenResponse, string>> {
	const clientId = opts.clientId ?? GITHUB_CLIENT_ID;
	const slowDownIncreaseMs = opts.slowDownIncreaseMs ?? 5_000;
	let intervalMs = Math.max(opts.interval, 0) * 1000;
	const deadline = Date.now() + opts.expiresIn * 1000;

	while (Date.now() < deadline) {
		await sleep(intervalMs);

		let body: Record<string, unknown>;
		try {
			const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					client_id: clientId,
					device_code: opts.deviceCode,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				}).toString(),
			});

			if (!response.ok) {
				// Network-layer failure. Keep polling if we have time left.
				if (Date.now() >= deadline) {
					return err(`GitHub token request failed (HTTP ${response.status}).`);
				}
				continue;
			}

			body = (await response.json()) as Record<string, unknown>;
		} catch (e) {
			// Transient network error — keep polling until deadline
			if (Date.now() >= deadline) {
				return err(
					`GitHub token request failed: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
			continue;
		}

		const errorCode = body.error;
		if (typeof errorCode === "string") {
			if (errorCode === "authorization_pending") continue;
			if (errorCode === "slow_down") {
				intervalMs += slowDownIncreaseMs;
				continue;
			}
			if (errorCode === "expired_token") {
				return err("Device code expired. Run `maina login --github` again.");
			}
			if (errorCode === "access_denied") {
				return err("Authorization denied on GitHub.");
			}
			return err(`GitHub rejected the token request: ${errorCode}`);
		}

		const accessToken = body.access_token;
		if (typeof accessToken !== "string") {
			return err("GitHub returned a malformed token response.");
		}

		return ok({
			accessToken,
			scope: typeof body.scope === "string" ? body.scope : "",
		});
	}

	return err("Device code expired. Run `maina login --github` again.");
}

/**
 * Exchange a GitHub access token for a maina bearer token.
 *
 * Calls `POST /auth/github/exchange` on the maina cloud API. The server
 * validates the token with GitHub and either creates or reuses the maina
 * member record keyed by `github_id`.
 */
export async function exchangeGitHubToken(
	baseUrl: string,
	githubAccessToken: string,
): Promise<Result<GitHubExchangeResponse, string>> {
	try {
		const response = await fetch(`${baseUrl}/auth/github/exchange`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({ github_access_token: githubAccessToken }),
		});

		const rawText = await response.text();
		let body: { data?: Record<string, unknown>; error?: string } = {};
		try {
			body = rawText ? JSON.parse(rawText) : {};
		} catch {
			return err(
				`GitHub token exchange failed (HTTP ${response.status}): ${rawText}`,
			);
		}

		if (!response.ok) {
			const serverError = body.error ?? `HTTP ${response.status}`;
			if (serverError === "invalid_github_token") {
				return err(
					"GitHub rejected the token (it may have been revoked). Try `maina login --github` again.",
				);
			}
			if (serverError === "github_user_lookup_failed") {
				return err("GitHub user lookup failed. Please retry in a moment.");
			}
			if (serverError === "provision_failed") {
				return err(
					"Maina cloud failed to provision your account. Please retry.",
				);
			}
			return err(serverError);
		}

		const d = body.data ?? {};
		const accessToken = d.access_token ?? d.accessToken;
		if (typeof accessToken !== "string") {
			return err("Maina cloud returned a malformed exchange response.");
		}
		return ok({
			accessToken,
			firstTime: Boolean(d.first_time ?? d.firstTime ?? false),
			memberId: String(d.member_id ?? d.memberId ?? ""),
			teamId: String(d.team_id ?? d.teamId ?? ""),
			githubLogin: String(d.github_login ?? d.githubLogin ?? ""),
			email: String(d.email ?? ""),
			expiresAt: String(d.expires_at ?? d.expiresAt ?? ""),
		});
	} catch (e) {
		return err(
			`GitHub token exchange failed: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}
