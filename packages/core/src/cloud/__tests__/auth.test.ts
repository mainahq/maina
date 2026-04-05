import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	clearAuthConfig,
	getAuthConfigPath,
	loadAuthConfig,
	saveAuthConfig,
	startDeviceFlow,
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
