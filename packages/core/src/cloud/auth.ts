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
import type { DeviceCodeResponse, TokenResponse } from "./types";

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
			data?: DeviceCodeResponse;
			error?: string;
		};
		if (body.error) {
			return err(body.error);
		}
		if (!body.data) {
			return err("Invalid response: missing data");
		}
		return ok(body.data);
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
					deviceCode,
					grantType: "urn:ietf:params:oauth:grant-type:device_code",
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
				data?: TokenResponse;
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
			return ok(body.data);
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
