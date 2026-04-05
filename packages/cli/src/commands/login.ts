/**
 * `maina login` — Device-flow OAuth login.
 * `maina logout` — Clear saved credentials.
 */

import { intro, log, outro, spinner } from "@clack/prompts";
import {
	clearAuthConfig,
	createCloudClient,
	loadAuthConfig,
	pollForToken,
	saveAuthConfig,
	startDeviceFlow,
} from "@mainahq/core";
import { Command } from "commander";

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_CLOUD_URL =
	process.env.MAINA_CLOUD_URL ?? "https://api.maina.dev";

// ── Login Action ────────────────────────────────────────────────────────────

export interface LoginActionResult {
	loggedIn: boolean;
	reason?: string;
}

export async function loginAction(): Promise<LoginActionResult> {
	// Check if already logged in
	const existing = loadAuthConfig();
	if (existing.ok) {
		log.info("Already logged in. Use `maina logout` to clear credentials.");
		return { loggedIn: true };
	}

	// Start device flow
	const s = spinner();
	s.start("Starting device authorization...");

	const flowResult = await startDeviceFlow(DEFAULT_CLOUD_URL);
	if (!flowResult.ok) {
		s.stop("Failed");
		log.error(flowResult.error);
		return { loggedIn: false, reason: flowResult.error };
	}

	const { userCode, deviceCode, verificationUri, interval, expiresIn } =
		flowResult.value;

	s.stop("Ready");

	log.info(`Open this URL in your browser:\n\n  ${verificationUri}\n`);
	log.info(`Enter code: ${userCode}\n`);

	// Poll for token
	s.start("Waiting for authorization...");

	const tokenResult = await pollForToken(
		DEFAULT_CLOUD_URL,
		deviceCode,
		interval,
		expiresIn,
	);

	if (!tokenResult.ok) {
		s.stop("Failed");
		log.error(tokenResult.error);
		return { loggedIn: false, reason: tokenResult.error };
	}

	s.stop("Authorized");

	// Save token
	const {
		accessToken,
		refreshToken,
		expiresIn: tokenExpiry,
	} = tokenResult.value;
	const expiresAt = new Date(Date.now() + tokenExpiry * 1000).toISOString();

	const saveResult = saveAuthConfig({ accessToken, refreshToken, expiresAt });
	if (!saveResult.ok) {
		log.error(saveResult.error);
		return { loggedIn: false, reason: saveResult.error };
	}

	// Verify token works
	const client = createCloudClient({
		baseUrl: DEFAULT_CLOUD_URL,
		token: accessToken,
	});

	const healthResult = await client.health();
	if (healthResult.ok) {
		log.success("Connected to maina cloud.");
	} else {
		log.warning(
			"Token saved but could not verify connection. The API may be temporarily unavailable.",
		);
	}

	return { loggedIn: true };
}

// ── Logout Action ───────────────────────────────────────────────────────────

export interface LogoutActionResult {
	loggedOut: boolean;
	reason?: string;
}

export async function logoutAction(): Promise<LogoutActionResult> {
	const result = clearAuthConfig();
	if (!result.ok) {
		log.error(result.error);
		return { loggedOut: false, reason: result.error };
	}

	return { loggedOut: true };
}

// ── Commander Commands ──────────────────────────────────────────────────────

export function loginCommand(): Command {
	return new Command("login")
		.description("Log in to maina cloud via device authorization")
		.action(async () => {
			intro("maina login");

			const result = await loginAction();

			if (result.loggedIn) {
				outro("Logged in!");
			} else {
				outro(`Login failed: ${result.reason}`);
			}
		});
}

export function logoutCommand(): Command {
	return new Command("logout")
		.description("Log out of maina cloud")
		.action(async () => {
			intro("maina logout");

			const result = await logoutAction();

			if (result.loggedOut) {
				log.success("Credentials cleared.");
				outro("Logged out.");
			} else {
				outro(`Logout failed: ${result.reason}`);
			}
		});
}
