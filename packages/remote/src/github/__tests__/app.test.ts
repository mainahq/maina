/**
 * The GitHub App side of the remote connector (FR-REM-2): the App is
 * registered and its installation tokens are requested with read-only
 * permissions unless the caller explicitly widens them, the App JWT is a
 * short-lived RS256 token, and the REST adapter maps GitHub's answers into
 * `Result`s against a fake GitHub API.
 */

import { describe, expect, test } from "bun:test";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import {
	appManifest,
	privateKeyCredentials,
	READ_ONLY_PERMISSIONS,
	restGitHubApi,
} from "../app";
import { API, APP_JWT, fakeGitHub, INSTALLATION_ID } from "./fake-github";

const REPO = { owner: "acme", name: "widgets" };
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

describe("read-only permissions by default", () => {
	test("every default permission is read", () => {
		expect(Object.keys(READ_ONLY_PERMISSIONS).length).toBeGreaterThan(0);
		for (const level of Object.values(READ_ONLY_PERMISSIONS)) {
			expect(level).toBe("read");
		}
		expect(READ_ONLY_PERMISSIONS).toMatchObject({
			contents: "read",
			pull_requests: "read",
			metadata: "read",
		});
	});

	test("the App manifest registers read-only permissions and PR events", () => {
		const manifest = appManifest({
			name: "maina",
			url: "https://maina.example.com",
			webhookUrl: "https://maina.example.com/github/webhook",
		});
		expect(manifest.default_permissions).toEqual(READ_ONLY_PERMISSIONS);
		expect(manifest.default_events).toEqual(["pull_request"]);
		expect(manifest.public).toBe(false);
		expect(manifest.hook_attributes.url).toBe(
			"https://maina.example.com/github/webhook",
		);
	});

	test("an installation token is requested for one repository, read-only", async () => {
		const gh = fakeGitHub();
		const api = restGitHubApi({ fetch: gh.fetch, baseUrl: API });
		const token = await api.installationToken({
			appJwt: APP_JWT,
			installationId: INSTALLATION_ID,
			repository: REPO,
		});
		expect(token.ok).toBe(true);
		const request = gh.requests.find((r) => r.path.endsWith("/access_tokens"));
		expect(request?.body).toEqual({
			repositories: ["widgets"],
			permissions: READ_ONLY_PERMISSIONS,
		});
	});

	test("wider permissions are only requested when the caller names them", async () => {
		const gh = fakeGitHub();
		const api = restGitHubApi({ fetch: gh.fetch, baseUrl: API });
		await api.installationToken({
			appJwt: APP_JWT,
			installationId: INSTALLATION_ID,
			repository: REPO,
			permissions: { ...READ_ONLY_PERMISSIONS, checks: "write" },
		});
		const request = gh.requests.find((r) => r.path.endsWith("/access_tokens"));
		expect(request?.body).toMatchObject({
			permissions: { checks: "write", contents: "read" },
		});
	});
});

describe("App credentials", () => {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs1", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	});
	const decode = (part: string): Record<string, unknown> =>
		JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

	test("the App JWT is RS256, issued by the App, backdated and short-lived", async () => {
		const now = 1_790_000_000_000;
		const credentials = privateKeyCredentials({
			appId: "123456",
			privateKey,
			now: () => now,
		});
		const jwt = await credentials.appJwt();
		if (!jwt.ok) throw new Error(jwt.error.message);
		const [header, claims, signature] = jwt.value.split(".");
		expect(decode(header ?? "")).toEqual({ alg: "RS256", typ: "JWT" });
		const body = decode(claims ?? "");
		expect(body.iss).toBe("123456");
		expect(body.iat).toBe(now / 1000 - 60);
		expect((body.exp as number) - (body.iat as number)).toBeLessThanOrEqual(
			600,
		);
		const valid = verify(
			"RSA-SHA256",
			Buffer.from(`${header}.${claims}`),
			createPublicKey(publicKey),
			Buffer.from(signature ?? "", "base64url"),
		);
		expect(valid).toBe(true);
	});

	test("an unusable private key is an error, not a throw", async () => {
		const credentials = privateKeyCredentials({
			appId: "1",
			privateKey: "not a key",
			now: () => 0,
		});
		const jwt = await credentials.appJwt();
		expect(jwt.ok).toBe(false);
	});
});

describe("REST adapter", () => {
	const pull = {
		number: 7,
		head: HEAD,
		base: BASE,
		cloneUrl: "https://github.test/acme/widgets.git",
		files: Array.from({ length: 5 }, (_, i) => ({
			filename: `src/f${i}.ts`,
			status: i === 4 ? "removed" : "modified",
		})),
	};

	async function tokenFor(gh: ReturnType<typeof fakeGitHub>) {
		const api = restGitHubApi({ fetch: gh.fetch, baseUrl: API });
		const token = await api.installationToken({
			appJwt: APP_JWT,
			installationId: INSTALLATION_ID,
			repository: REPO,
		});
		if (!token.ok) throw new Error(token.error.message);
		return { api, token: token.value.token };
	}

	test("reads a pull request and pages through its files", async () => {
		const gh = fakeGitHub({ pulls: [pull], maxPerPage: 2 });
		const { api, token } = await tokenFor(gh);
		const pr = await api.pullRequest({ token, repository: REPO, number: 7 });
		expect(pr).toEqual({
			ok: true,
			value: {
				number: 7,
				headSha: HEAD,
				baseSha: BASE,
				cloneUrl: pull.cloneUrl,
			},
		});
		const files = await api.pullRequestFiles({
			token,
			repository: REPO,
			number: 7,
		});
		expect(files.ok && files.value.map((f) => f.path)).toEqual(
			pull.files.map((f) => f.filename),
		);
		expect(files.ok && files.value[4]?.status).toBe("removed");
	});

	test("finds where the head forked from the base (the PR's diff base)", async () => {
		const FORK = "c".repeat(40);
		const gh = fakeGitHub({ pulls: [{ ...pull, mergeBase: FORK }] });
		const { api, token } = await tokenFor(gh);
		expect(
			await api.mergeBase({ token, repository: REPO, base: BASE, head: HEAD }),
		).toEqual({ ok: true, value: FORK });
		expect(gh.requests.at(-1)?.path).toStartWith(
			`/repos/acme/widgets/compare/${BASE}...${HEAD}`,
		);
	});

	test("a malformed compare answer is a github error", async () => {
		const api = restGitHubApi({
			fetch: async () => Response.json({ merge_base_commit: {} }),
			baseUrl: API,
		});
		const found = await api.mergeBase({
			token: "t",
			repository: REPO,
			base: BASE,
			head: HEAD,
		});
		expect(!found.ok && found.error.kind).toBe("github");
	});

	test("a GitHub error status comes back as a github error", async () => {
		const gh = fakeGitHub({ pulls: [pull] });
		const { api, token } = await tokenFor(gh);
		const missing = await api.pullRequest({
			token,
			repository: REPO,
			number: 99,
		});
		expect(missing).toEqual({
			ok: false,
			error: { kind: "github", status: 404, message: "Not Found" },
		});
		const denied = await api.installationToken({
			appJwt: "forged",
			installationId: INSTALLATION_ID,
			repository: REPO,
		});
		expect(!denied.ok && denied.error.status).toBe(401);
	});

	test("a network failure is an error, not a throw", async () => {
		const api = restGitHubApi({
			fetch: () => Promise.reject(new Error("ECONNRESET")),
			baseUrl: API,
		});
		const pr = await api.pullRequest({
			token: "t",
			repository: REPO,
			number: 1,
		});
		expect(pr).toEqual({
			ok: false,
			error: { kind: "github", status: null, message: "ECONNRESET" },
		});
	});

	test("revoking the token ends it", async () => {
		const gh = fakeGitHub();
		const { api, token } = await tokenFor(gh);
		expect(gh.liveTokens()).toEqual([token]);
		expect(await api.revokeToken(token)).toEqual({
			ok: true,
			value: undefined,
		});
		expect(gh.liveTokens()).toEqual([]);
	});
});
