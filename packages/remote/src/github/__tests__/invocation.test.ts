/**
 * The one-shot job process's input: the job from argv, the App's id and
 * private key from the environment. Anything missing or malformed is an
 * error naming the flag or variable, before any network call.
 */

import { describe, expect, test } from "bun:test";
import { appSecretNames, readJobInvocation } from "../invocation";

const ENV = {
	MAINA_GITHUB_APP_ID: "123456",
	MAINA_GITHUB_APP_PRIVATE_KEY:
		"-----BEGIN RSA PRIVATE KEY-----\\nabc\\n-----END RSA PRIVATE KEY-----",
};
const BASE = [
	"--repo",
	"acme/widgets",
	"--pr",
	"7",
	"--installation",
	"4242",
] as const;

describe("readJobInvocation", () => {
	test("reads a verify job and the App credentials", () => {
		const read = readJobInvocation(["verify", ...BASE], ENV);
		expect(read).toEqual({
			ok: true,
			value: {
				appId: "123456",
				// Escaped newlines, as a key pasted into one env line has them.
				privateKey:
					"-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
				request: {
					kind: "verify",
					repository: { owner: "acme", name: "widgets" },
					pullNumber: 7,
					installationId: 4242,
				},
			},
		});
	});

	test("an API url is passed through for GitHub Enterprise", () => {
		const read = readJobInvocation(["triage", ...BASE], {
			...ENV,
			MAINA_GITHUB_API_URL: "https://ghe.example.com/api/v3",
		});
		expect(read.ok && read.value.apiUrl).toBe("https://ghe.example.com/api/v3");
	});

	test("reads each job's own flags", () => {
		const impact = readJobInvocation(["impact", ...BASE, "--depth", "3"], ENV);
		expect(impact.ok && impact.value.request).toMatchObject({
			kind: "impact",
			depth: 3,
		});
		const spec = readJobInvocation(
			[
				"spec_check",
				...BASE,
				"--paths",
				".maina/features/001-a,.maina/features/002-b",
			],
			ENV,
		);
		expect(spec.ok && spec.value.request).toMatchObject({
			kind: "spec_check",
			paths: [".maina/features/001-a", ".maina/features/002-b"],
		});
		const request = { type: "review.merge", state: {}, questions: [] };
		const decide = readJobInvocation(
			["decide", ...BASE, "--request", JSON.stringify(request)],
			ENV,
		);
		expect(decide.ok && decide.value.request).toMatchObject({
			kind: "decide",
			request,
		});
	});

	test("refuses an unknown job, naming the supported ones", () => {
		const read = readJobInvocation(["deploy", ...BASE], ENV);
		expect(read.ok).toBe(false);
		expect(!read.ok && read.error.message).toContain(
			"verify, impact, triage, spec_check, decide",
		);
	});

	test.each([
		[
			["verify", "--repo", "acme", "--pr", "7", "--installation", "1"],
			"--repo",
		],
		[
			["verify", "--repo", "acme/widgets", "--pr", "x", "--installation", "1"],
			"--pr",
		],
		[["verify", "--repo", "acme/widgets", "--pr", "7"], "--installation"],
		[["decide", ...BASE], "--request"],
		[["decide", ...BASE, "--request", "{nope"], "--request"],
		[["impact", ...BASE, "--depth", "-1"], "--depth"],
		[["verify", ...BASE, "--bogus"], "--bogus"],
	])("refuses %j (names %s)", (argv, what) => {
		const read = readJobInvocation(argv, ENV);
		expect(read.ok).toBe(false);
		expect(!read.ok && read.error.name).toBe(what);
	});

	test("requires the App id and private key", () => {
		const noId = readJobInvocation(["verify", ...BASE], {
			MAINA_GITHUB_APP_PRIVATE_KEY: "k",
		});
		expect(!noId.ok && noId.error.name).toBe("MAINA_GITHUB_APP_ID");
		const noKey = readJobInvocation(["verify", ...BASE], {
			MAINA_GITHUB_APP_ID: "1",
		});
		expect(!noKey.ok && noKey.error.name).toBe("MAINA_GITHUB_APP_PRIVATE_KEY");
	});
});

describe("appSecretNames", () => {
	test("names every MAINA_GITHUB_APP_* variable, and nothing else", () => {
		expect(
			appSecretNames({
				...ENV,
				MAINA_GITHUB_APP_WEBHOOK_SECRET: "s",
				MAINA_GITHUB_API_URL: "https://ghe.example.com/api/v3",
				PATH: "/usr/bin",
			}).sort(),
		).toEqual([
			"MAINA_GITHUB_APP_ID",
			"MAINA_GITHUB_APP_PRIVATE_KEY",
			"MAINA_GITHUB_APP_WEBHOOK_SECRET",
		]);
	});
});
