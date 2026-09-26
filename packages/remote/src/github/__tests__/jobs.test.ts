/**
 * GitHub App jobs (FR-REM-2, FR-REM-3): a job authenticates as the App,
 * takes a read-only installation token for the PR's repository, checks the
 * PR out into an ephemeral workspace, runs the requested capability through
 * the runtime in that workspace, deletes the workspace afterwards
 * (verified) and revokes the token. The supported jobs are PR verify,
 * impact, triage, spec check and decide.
 */

import { describe, expect, test } from "bun:test";
import type { McpRuntime } from "@mainahq/mcp";
import {
	type AppCredentials,
	READ_ONLY_PERMISSIONS,
	restGitHubApi,
} from "../app";
import type { Workspaces } from "../checkout";
import { createJobRunner, JOB_KINDS, type JobRequest } from "../jobs";
import { API, APP_JWT, fakeGitHub, INSTALLATION_ID } from "./fake-github";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const CLONE = "https://github.test/acme/widgets.git";
const REPO = { owner: "acme", name: "widgets" };
const TARGET = {
	installationId: INSTALLATION_ID,
	repository: REPO,
	pullNumber: 7,
} as const;

const PULL = {
	number: 7,
	head: HEAD,
	base: BASE,
	cloneUrl: CLONE,
	files: [
		{ filename: "src/app.ts", status: "modified" },
		{ filename: "src/gone.ts", status: "removed" },
		{ filename: ".maina/features/012-login/spec.md", status: "added" },
		{ filename: ".maina/features/012-login/plan.md", status: "added" },
	],
};

const credentials: AppCredentials = {
	appJwt: async () => ({ ok: true, value: APP_JWT }),
};

type Call = Readonly<{ method: string; args: Readonly<{ root?: string }> }>;

type Tracked = {
	workspaces: Workspaces;
	present: Set<string>;
	created: string[];
	checkouts: unknown[];
};

function trackedWorkspaces(): Tracked {
	const present = new Set<string>();
	const created: string[] = [];
	const checkouts: unknown[] = [];
	const workspaces: Workspaces = {
		create: async () => {
			const dir = `/tmp/maina-job-${created.length + 1}`;
			created.push(dir);
			present.add(dir);
			return { ok: true, value: dir };
		},
		checkout: async (dir, source) => {
			checkouts.push({ dir, ...source });
			return { ok: true, value: undefined };
		},
		remove: async (dir) => {
			present.delete(dir);
			return { ok: true, value: undefined };
		},
		exists: async (dir) => present.has(dir),
	};
	return { workspaces, present, created, checkouts };
}

function recordingRuntime(
	root: string,
	present: Set<string>,
	calls: Call[],
): McpRuntime {
	const record =
		(method: string, value: unknown) => (args: Readonly<{ root?: string }>) => {
			// The capability runs while the checkout exists.
			expect(present.has(root)).toBe(true);
			calls.push({ method, args });
			return Promise.resolve({ ok: true as const, value: value as never });
		};
	const unused = () =>
		Promise.resolve({
			ok: false as const,
			error: { kind: "failed" as const, message: "not a job capability" },
		});
	return {
		resolveRoot: async () => ({ ok: true, value: root }),
		verify: record("verify", { passed: true, findings: [] }),
		impact: record("impact", { files: [] }),
		review: record("review", { result: { passed: true }, delegated: false }),
		specCheck: record("specCheck", []),
		decide: record("decide", []),
		context: unused,
		receipts: unused,
		status: unused,
		wiki: { ask: unused, structure: unused, contents: unused },
	};
}

function setup(permissions?: Readonly<Record<string, "read" | "write">>) {
	const gh = fakeGitHub({ pulls: [PULL] });
	const tracked = trackedWorkspaces();
	const calls: Call[] = [];
	const roots: string[] = [];
	const run = createJobRunner({
		credentials,
		api: restGitHubApi({ fetch: gh.fetch, baseUrl: API }),
		workspaces: tracked.workspaces,
		runtimeFor: (root) => {
			roots.push(root);
			return recordingRuntime(root, tracked.present, calls);
		},
		...(permissions !== undefined ? { permissions } : {}),
	});
	return { gh, tracked, calls, roots, run };
}

describe("supported jobs", () => {
	test("are PR verify, impact, triage, spec check and decide", () => {
		expect([...JOB_KINDS].sort()).toEqual([
			"decide",
			"impact",
			"spec_check",
			"triage",
			"verify",
		]);
	});

	test("an unknown job kind is refused before GitHub is contacted", async () => {
		const { run, gh, tracked } = setup();
		const result = await run({
			...TARGET,
			kind: "deploy",
		} as unknown as JobRequest);
		expect(!result.ok && result.error.kind).toBe("invalid_request");
		expect(gh.requests).toEqual([]);
		expect(tracked.created).toEqual([]);
	});

	const cases: readonly [JobRequest, string, Record<string, unknown>][] = [
		[
			{ ...TARGET, kind: "verify" },
			"verify",
			{
				files: [
					"src/app.ts",
					".maina/features/012-login/spec.md",
					".maina/features/012-login/plan.md",
				],
				base: BASE,
			},
		],
		[
			{ ...TARGET, kind: "impact", depth: 2 },
			"impact",
			{
				files: [
					"src/app.ts",
					".maina/features/012-login/spec.md",
					".maina/features/012-login/plan.md",
				],
				depth: 2,
			},
		],
		[{ ...TARGET, kind: "triage" }, "review", { base: BASE }],
		[
			{ ...TARGET, kind: "spec_check" },
			"specCheck",
			{ paths: [".maina/features/012-login"] },
		],
		[
			{
				...TARGET,
				kind: "decide",
				request: {
					type: "review.merge",
					state: {},
					questions: [],
				} as unknown as Extract<JobRequest, { kind: "decide" }>["request"],
			},
			"decide",
			{ request: { type: "review.merge", state: {}, questions: [] } },
		],
	];

	for (const [request, method, args] of cases) {
		test(`${request.kind} checks out the PR, runs ${method} in the workspace, then deletes it`, async () => {
			const { run, tracked, calls, roots, gh } = setup();
			const result = await run(request);
			if (!result.ok) throw new Error(JSON.stringify(result.error));

			const dir = tracked.created[0] ?? "";
			expect(tracked.created).toHaveLength(1);
			expect(tracked.checkouts).toEqual([
				{ dir, cloneUrl: CLONE, token: "ghs_fake_1", head: HEAD, base: BASE },
			]);
			expect(roots).toEqual([dir]);
			expect(calls).toEqual([{ method, args: { root: dir, ...args } }]);

			expect(result.value).toMatchObject({
				kind: request.kind,
				repository: "acme/widgets",
				pullNumber: 7,
				head: HEAD,
				base: BASE,
				workspace: { path: dir, removed: true },
			});
			expect(tracked.present.size).toBe(0);
			// The installation token does not outlive the job.
			expect(gh.liveTokens()).toEqual([]);
		});
	}
});

describe("read-only by default", () => {
	test("the job's installation token is read-only for the PR's repository", async () => {
		const { run, gh } = setup();
		await run({ ...TARGET, kind: "verify" });
		const tokenRequest = gh.requests.find((r) =>
			r.path.endsWith("/access_tokens"),
		);
		expect(tokenRequest?.body).toEqual({
			repositories: ["widgets"],
			permissions: READ_ONLY_PERMISSIONS,
		});
	});

	test("an operator can widen them explicitly", async () => {
		const { run, gh } = setup({ ...READ_ONLY_PERMISSIONS, checks: "write" });
		await run({ ...TARGET, kind: "verify" });
		const tokenRequest = gh.requests.find((r) =>
			r.path.endsWith("/access_tokens"),
		);
		expect(tokenRequest?.body).toMatchObject({
			permissions: { checks: "write" },
		});
	});
});

describe("failures", () => {
	test("a capability failure still deletes the workspace and revokes the token", async () => {
		const gh = fakeGitHub({ pulls: [PULL] });
		const tracked = trackedWorkspaces();
		const run = createJobRunner({
			credentials,
			api: restGitHubApi({ fetch: gh.fetch, baseUrl: API }),
			workspaces: tracked.workspaces,
			runtimeFor: (root) => ({
				...recordingRuntime(root, tracked.present, []),
				verify: async () => ({
					ok: false,
					error: { kind: "failed", message: "biome crashed" },
				}),
			}),
		});
		const result = await run({ ...TARGET, kind: "verify" });
		expect(result).toEqual({
			ok: false,
			error: {
				kind: "capability",
				error: { kind: "failed", message: "biome crashed" },
			},
		});
		expect(tracked.present.size).toBe(0);
		expect(gh.liveTokens()).toEqual([]);
	});

	test("decide refuses the action gate's decision types remotely", async () => {
		const { run, calls, tracked } = setup();
		const result = await run({
			...TARGET,
			kind: "decide",
			request: {
				type: "action.risk",
				state: {},
				questions: [],
			} as unknown as Extract<JobRequest, { kind: "decide" }>["request"],
		});
		expect(!result.ok && result.error).toMatchObject({
			kind: "capability",
			error: { kind: "invalid_input" },
		});
		expect(calls).toEqual([]);
		expect(tracked.present.size).toBe(0);
	});

	test("a spec path outside the workspace is refused before checkout", async () => {
		const { run, tracked } = setup();
		const result = await run({
			...TARGET,
			kind: "spec_check",
			paths: ["../../etc"],
		});
		expect(!result.ok && result.error.kind).toBe("invalid_request");
		expect(tracked.created).toEqual([]);
	});

	test("a missing pull request is a github error and no workspace is made", async () => {
		const { run, tracked, gh } = setup();
		const result = await run({ ...TARGET, pullNumber: 99, kind: "verify" });
		expect(!result.ok && result.error).toMatchObject({
			kind: "github",
			status: 404,
		});
		expect(tracked.created).toEqual([]);
		expect(gh.liveTokens()).toEqual([]);
	});

	test("a workspace that survives deletion fails the job", async () => {
		const gh = fakeGitHub({ pulls: [PULL] });
		const tracked = trackedWorkspaces();
		const run = createJobRunner({
			credentials,
			api: restGitHubApi({ fetch: gh.fetch, baseUrl: API }),
			workspaces: {
				...tracked.workspaces,
				remove: async () => ({ ok: true, value: undefined }),
			},
			runtimeFor: (root) => recordingRuntime(root, tracked.present, []),
		});
		const result = await run({ ...TARGET, kind: "verify" });
		expect(!result.ok && result.error.kind).toBe("cleanup_failed");
	});
});
