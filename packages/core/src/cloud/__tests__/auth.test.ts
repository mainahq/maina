import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	clearAuthConfig,
	exchangeGitHubToken,
	GITHUB_CLIENT_ID,
	getAuthConfigPath,
	loadAuthConfig,
	pollGitHubToken,
	saveAuthConfig,
	startDeviceFlow,
	startGitHubDeviceFlow,
} from "../auth";

// ── Helpers ─────────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

let tmpDir: string;
let mockFetch: ReturnType<typeof mock>;

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// ── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });

	mockFetch = mock(() =>
		Promise.resolve(jsonResponse({ data: { status: "ok" } })),
	);
	globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("getAuthConfigPath", () => {
	test("returns path inside custom config dir", () => {
		const path = getAuthConfigPath("/custom/dir");
		expect(path).toBe("/custom/dir/auth.json");
	});

	test("defaults to home directory", () => {
		const path = getAuthConfigPath();
		expect(path).toContain(".maina");
		expect(path).toEndWith("auth.json");
	});
});

describe("saveAuthConfig / loadAuthConfig", () => {
	test("round-trips auth config", () => {
		const config = {
			accessToken: "tok-abc-123",
			refreshToken: "ref-xyz",
			expiresAt: "2026-12-31T23:59:59Z",
		};

		const saveResult = saveAuthConfig(config, tmpDir);
		expect(saveResult.ok).toBe(true);

		const loadResult = loadAuthConfig(tmpDir);
		expect(loadResult.ok).toBe(true);
		if (loadResult.ok) {
			expect(loadResult.value.accessToken).toBe("tok-abc-123");
			expect(loadResult.value.refreshToken).toBe("ref-xyz");
			expect(loadResult.value.expiresAt).toBe("2026-12-31T23:59:59Z");
		}
	});

	test("creates parent directories", () => {
		const nested = join(tmpDir, "a", "b", "c");
		const result = saveAuthConfig({ accessToken: "t" }, nested);
		expect(result.ok).toBe(true);
		expect(existsSync(join(nested, "auth.json"))).toBe(true);
	});

	test("returns error when not logged in", () => {
		const result = loadAuthConfig(join(tmpDir, "nonexistent"));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Not logged in");
		}
	});

	test("returns error for malformed config", () => {
		const authPath = join(tmpDir, "auth.json");
		writeFileSync(authPath, '{"no_token": true}', "utf-8");

		const result = loadAuthConfig(tmpDir);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("missing accessToken");
		}
	});
});

describe("clearAuthConfig", () => {
	test("removes auth file", () => {
		saveAuthConfig({ accessToken: "t" }, tmpDir);
		const authPath = getAuthConfigPath(tmpDir);
		expect(existsSync(authPath)).toBe(true);

		const result = clearAuthConfig(tmpDir);
		expect(result.ok).toBe(true);
		expect(existsSync(authPath)).toBe(false);
	});

	test("succeeds when no file exists", () => {
		const result = clearAuthConfig(join(tmpDir, "nonexistent"));
		expect(result.ok).toBe(true);
	});
});

describe("startDeviceFlow", () => {
	test("returns device code response on success", async () => {
		const deviceData = {
			userCode: "ABCD-1234",
			deviceCode: "dev-code-xyz",
			verificationUri: "https://maina.dev/device",
			interval: 5,
			expiresIn: 900,
		};
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ data: deviceData })),
		);

		const result = await startDeviceFlow("https://api.maina.dev");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.userCode).toBe("ABCD-1234");
			expect(result.value.deviceCode).toBe("dev-code-xyz");
			expect(result.value.verificationUri).toBe("https://maina.dev/device");
		}
	});

	test("returns error on API failure", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ error: "Service unavailable" }, 503)),
		);

		const result = await startDeviceFlow("https://api.maina.dev");

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("503");
		}
	});
});

// ── GitHub Device Flow ──────────────────────────────────────────────────────

describe("startGitHubDeviceFlow", () => {
	test("POSTs client_id + scope to github.com/login/device/code", async () => {
		const seen: { url: string; body: string } = { url: "", body: "" };
		mockFetch.mockImplementation((url: string, init?: RequestInit) => {
			seen.url = url;
			seen.body = String(init?.body ?? "");
			return Promise.resolve(
				jsonResponse({
					device_code: "dev-xyz",
					user_code: "ABCD-1234",
					verification_uri: "https://github.com/login/device",
					expires_in: 900,
					interval: 5,
				}),
			);
		});

		const result = await startGitHubDeviceFlow();

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.deviceCode).toBe("dev-xyz");
			expect(result.value.userCode).toBe("ABCD-1234");
			expect(result.value.verificationUri).toBe(
				"https://github.com/login/device",
			);
			expect(result.value.interval).toBe(5);
		}
		expect(seen.url).toBe("https://github.com/login/device/code");
		expect(seen.body).toContain(`client_id=${GITHUB_CLIENT_ID}`);
		expect(seen.body).toContain("scope=read%3Auser");
	});

	test("surfaces device_flow_disabled with an actionable message", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ error: "device_flow_disabled" })),
		);

		const result = await startGitHubDeviceFlow();
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("Device Flow");
	});

	test("returns error on malformed response", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ user_code: "ABCD-1234" })),
		);

		const result = await startGitHubDeviceFlow();
		expect(result.ok).toBe(false);
	});
});

describe("pollGitHubToken", () => {
	test("keeps polling on authorization_pending, then returns token", async () => {
		let calls = 0;
		mockFetch.mockImplementation(() => {
			calls++;
			if (calls < 2) {
				return Promise.resolve(
					jsonResponse({ error: "authorization_pending" }),
				);
			}
			return Promise.resolve(
				jsonResponse({
					access_token: "gho_abc123",
					scope: "read:user",
					token_type: "bearer",
				}),
			);
		});

		const result = await pollGitHubToken({
			deviceCode: "dev-xyz",
			interval: 0, // poll as fast as possible
			expiresIn: 5,
		});

		expect(result.ok).toBe(true);
		expect(calls).toBe(2);
		if (result.ok) {
			expect(result.value.accessToken).toBe("gho_abc123");
			expect(result.value.scope).toBe("read:user");
		}
	});

	test("aborts on expired_token", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ error: "expired_token" })),
		);
		const result = await pollGitHubToken({
			deviceCode: "dev-xyz",
			interval: 0,
			expiresIn: 5,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("expired");
	});

	test("aborts on access_denied", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ error: "access_denied" })),
		);
		const result = await pollGitHubToken({
			deviceCode: "dev-xyz",
			interval: 0,
			expiresIn: 5,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("denied");
	});

	test("backs off on slow_down before eventually succeeding", async () => {
		let calls = 0;
		mockFetch.mockImplementation(() => {
			calls++;
			if (calls === 1) {
				return Promise.resolve(jsonResponse({ error: "slow_down" }));
			}
			return Promise.resolve(
				jsonResponse({ access_token: "gho_tok", scope: "read:user" }),
			);
		});
		const result = await pollGitHubToken({
			deviceCode: "dev-xyz",
			interval: 0,
			expiresIn: 30,
			slowDownIncreaseMs: 10,
		});
		expect(result.ok).toBe(true);
		expect(calls).toBe(2);
	});
});

describe("exchangeGitHubToken", () => {
	test("sends github_access_token and parses snake_case response", async () => {
		const seen: { url: string; body: string } = { url: "", body: "" };
		mockFetch.mockImplementation((url: string, init?: RequestInit) => {
			seen.url = url;
			seen.body = String(init?.body ?? "");
			return Promise.resolve(
				jsonResponse({
					data: {
						access_token: "maina_tok",
						first_time: true,
						member_id: "member_1",
						team_id: "team_1",
						github_login: "alice",
						email: "alice@example.com",
						expires_at: "2026-05-18T00:00:00Z",
					},
					error: null,
				}),
			);
		});

		const result = await exchangeGitHubToken(
			"https://api.maina.dev",
			"gho_abc",
		);

		expect(result.ok).toBe(true);
		expect(seen.url).toBe("https://api.maina.dev/auth/github/exchange");
		expect(seen.body).toContain("gho_abc");
		if (result.ok) {
			expect(result.value.accessToken).toBe("maina_tok");
			expect(result.value.firstTime).toBe(true);
			expect(result.value.githubLogin).toBe("alice");
		}
	});

	test("maps invalid_github_token to an actionable message", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ error: "invalid_github_token" }, 401)),
		);
		const result = await exchangeGitHubToken("https://api.maina.dev", "t");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("revoked");
	});

	test("maps provision_failed", async () => {
		mockFetch.mockImplementation(() =>
			Promise.resolve(jsonResponse({ error: "provision_failed" }, 502)),
		);
		const result = await exchangeGitHubToken("https://api.maina.dev", "t");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("provision");
	});
});
