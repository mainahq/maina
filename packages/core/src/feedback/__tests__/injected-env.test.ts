/**
 * Feedback cloud sync resolves its base URL from an injected `EnvPort`
 * (issue #292), never `process.env`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envFromRecord } from "../../ports/env";
import { recordFeedbackAsync } from "../collector";

let dir: string;
let authDir: string;
let urls: string[];
let originalFetch: typeof fetch;
let savedCloudUrl: string | undefined;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "maina-292-feedback-"));
	authDir = join(dir, "auth");
	mkdirSync(authDir, { recursive: true });
	writeFileSync(
		join(authDir, "auth.json"),
		JSON.stringify({ accessToken: "tok-292" }),
	);
	urls = [];
	originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request) => {
		urls.push(String(input));
		return new Response(JSON.stringify({ data: {} }), { status: 200 });
	}) as typeof fetch;
	savedCloudUrl = process.env.MAINA_CLOUD_URL;
	process.env.MAINA_CLOUD_URL = "https://wrong.example";
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (savedCloudUrl === undefined) delete process.env.MAINA_CLOUD_URL;
	else process.env.MAINA_CLOUD_URL = savedCloudUrl;
	rmSync(dir, { recursive: true, force: true });
});

describe("recordFeedbackAsync cloud sync", () => {
	test("posts to the MAINA_CLOUD_URL from the injected env", async () => {
		recordFeedbackAsync(
			join(dir, ".maina"),
			{
				promptHash: "hash-292",
				task: "verify",
				accepted: true,
				timestamp: new Date().toISOString(),
			},
			{
				env: envFromRecord({ MAINA_CLOUD_URL: "https://cloud.test" }),
				authDir,
			},
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(urls.length).toBeGreaterThan(0);
		expect(urls.every((u) => u.startsWith("https://cloud.test/"))).toBe(true);
	});
});
