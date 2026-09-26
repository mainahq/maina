import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	computeReceiptHash,
	type HttpPort,
	type HttpRequest,
	type Receipt,
} from "@mainahq/core";
import { receiptCommand } from "../receipt";
import { receiptPublishAction } from "../receipt-publish";

const SHA = "e".repeat(40);

function signedReceipt(): Receipt {
	const body: Omit<Receipt, "hash"> = {
		prTitle: "Add retry",
		repo: "acme/widgets",
		timestamp: "2026-09-26T10:00:00Z",
		status: "passed",
		diff: { additions: 5, deletions: 1, files: 2 },
		agent: { id: "claude-code", modelVersion: "claude-opus-5-5" },
		promptVersion: {
			constitutionHash: "a".repeat(64),
			promptsHash: "b".repeat(64),
		},
		checks: [
			{
				id: "biome",
				name: "Biome",
				status: "passed",
				tool: "biome",
				findings: [],
			},
		],
		walkthrough: "Adds a retry.",
		feedback: [],
		retries: 0,
	};
	const hash = computeReceiptHash(body);
	if (!hash.ok) throw new Error(hash.message);
	return { ...body, hash: hash.data };
}

/** Answers every GitHub call with an empty list or a fresh id. */
function recordingHttp(status = 201): {
	http: HttpPort;
	requests: HttpRequest[];
} {
	const requests: HttpRequest[] = [];
	return {
		requests,
		http: {
			request: async (req) => {
				requests.push(req);
				if (req.method === "GET") {
					const body = req.url.includes("check-runs")
						? { total_count: 0, check_runs: [] }
						: [];
					return {
						ok: true,
						value: { status: 200, body: JSON.stringify(body) },
					};
				}
				return {
					ok: true,
					value: { status, body: JSON.stringify({ id: 42 }) },
				};
			},
		},
	};
}

describe("receiptPublishAction", () => {
	let dir: string;
	let receiptPath: string;
	const env = (vars: Record<string, string>) => (name: string) => vars[name];

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "maina-receipt-publish-"));
		receiptPath = join(dir, "receipt.json");
		writeFileSync(receiptPath, JSON.stringify(signedReceipt()));
	});

	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("without opt-in nothing is requested, and no token is needed", async () => {
		const { http, requests } = recordingHttp();
		const result = await receiptPublishAction(
			{ receipt: receiptPath, pr: "7", sha: SHA, repo: "acme/widgets" },
			{ http, env: env({}) },
		);
		expect(result).toEqual({
			ok: true,
			outcome: { kind: "skipped", reason: "not_opted_in" },
		});
		expect(requests).toHaveLength(0);
	});

	test("publishes the comment and check run with the token from the environment", async () => {
		const { http, requests } = recordingHttp();
		const result = await receiptPublishAction(
			{
				receipt: receiptPath,
				pr: "7",
				sha: SHA,
				optIn: true,
				scopeBase: "origin/main",
				receiptUrl: "https://github.com/acme/widgets/actions/runs/1",
			},
			{
				http,
				env: env({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "acme/widgets" }),
			},
		);
		expect(result.ok && result.outcome.kind).toBe("published");
		const comment = requests.find(
			(r) => r.method === "POST" && r.url.endsWith("/issues/7/comments"),
		);
		expect(comment?.headers.authorization).toBe("Bearer tok");
		const body = JSON.parse(comment?.body ?? "{}").body as string;
		expect(body).toContain("passed 1 of 1 checks");
		expect(body).toContain("`origin/main`");
		expect(body).toContain(
			"[Full receipt](https://github.com/acme/widgets/actions/runs/1)",
		);
	});

	test("a read-only token writes the receipt to the job summary instead", async () => {
		const { http, requests } = recordingHttp();
		const summary = join(dir, "summary.md");
		writeFileSync(summary, "existing\n");
		const result = await receiptPublishAction(
			{
				receipt: receiptPath,
				pr: "7",
				sha: SHA,
				optIn: true,
				readOnly: true,
			},
			{
				http,
				env: env({
					GITHUB_TOKEN: "tok",
					GITHUB_REPOSITORY: "acme/widgets",
					GITHUB_STEP_SUMMARY: summary,
				}),
			},
		);
		expect(result.ok && result.outcome.kind).toBe("fallback");
		expect(requests.filter((r) => r.method !== "GET")).toHaveLength(0);
		const written = readFileSync(summary, "utf-8");
		expect(written.startsWith("existing\n")).toBe(true);
		expect(written).toContain("passed 1 of 1 checks");
	});

	test("merges criteria and gate counts from a context file", async () => {
		const { http, requests } = recordingHttp();
		const context = join(dir, "context.json");
		writeFileSync(
			context,
			JSON.stringify({
				criteria: [
					{ id: "AC-1", text: "retries", status: "met", evidence: ["tests"] },
				],
				gate: { blocked: 1, asked: 0, allowed: 3, overrides: [] },
			}),
		);
		await receiptPublishAction(
			{ receipt: receiptPath, context, pr: "7", sha: SHA, optIn: true },
			{
				http,
				env: env({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "acme/widgets" }),
			},
		);
		const comment = requests.find((r) => r.method === "POST");
		const body = JSON.parse(comment?.body ?? "{}").body as string;
		expect(body).toContain("AC-1");
		expect(body).toContain("1 blocked");
	});

	test("refuses a tampered receipt before publishing", async () => {
		const { http, requests } = recordingHttp();
		const tampered = join(dir, "tampered.json");
		writeFileSync(
			tampered,
			JSON.stringify({ ...signedReceipt(), status: "failed" }),
		);
		const result = await receiptPublishAction(
			{ receipt: tampered, pr: "7", sha: SHA, optIn: true },
			{
				http,
				env: env({ GITHUB_TOKEN: "tok", GITHUB_REPOSITORY: "acme/widgets" }),
			},
		);
		expect(result.ok).toBe(false);
		expect(requests).toHaveLength(0);
	});

	test("`maina receipt publish` routes its flags and honours --json", async () => {
		const writes: string[] = [];
		const original = process.stdout.write.bind(process.stdout);
		const exitCode = process.exitCode;
		process.stdout.write = ((chunk: string) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;
		try {
			await receiptCommand().parseAsync(
				["publish", "--receipt", receiptPath, "--scope-base", "b", "--json"],
				{ from: "user" },
			);
		} finally {
			process.stdout.write = original;
			process.exitCode = exitCode;
		}
		const envelope = JSON.parse(writes.join(""));
		expect(envelope.data.outcome).toEqual({
			kind: "skipped",
			reason: "not_opted_in",
		});
	});

	test("an opted-in publish without a token is a config error", async () => {
		const { http } = recordingHttp();
		const result = await receiptPublishAction(
			{ receipt: receiptPath, pr: "7", sha: SHA, optIn: true },
			{ http, env: env({ GITHUB_REPOSITORY: "acme/widgets" }) },
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("no_token");
	});
});

describe("verify Action wiring", () => {
	const actionPath = join(
		import.meta.dir,
		"../../../../../.github/actions/verify/action.yml",
	);
	type Step = { name: string; if?: string; run?: string };
	const action = Bun.YAML.parse(readFileSync(actionPath, "utf-8")) as {
		inputs: Record<string, { default: string }>;
		runs: { steps: Step[] };
	};
	const step = (name: string): Step =>
		action.runs.steps.find((s) => s.name === name) ?? { name };

	test("the PR receipt is opt-in and off by default", () => {
		expect(action.inputs["pr-comment"]?.default).toBe("false");
		expect(step("Build PR receipt").if).toContain(
			"inputs.pr-comment == 'true'",
		);
		expect(step("Publish PR receipt").run).toContain("--opt-in");
	});

	test("a fork PR on pull_request publishes read-only (job summary fallback)", () => {
		const run = step("Publish PR receipt").run ?? "";
		expect(run).toMatch(
			/EVENT_NAME" = "pull_request" \] && \[ "\$HEAD_REPO" != "\$GITHUB_REPOSITORY" \][\s\S]*--read-only/,
		);
	});

	test("every flag the Action passes is one `receipt publish` accepts", () => {
		const run = step("Publish PR receipt").run ?? "";
		const passed = [...run.matchAll(/(--[a-z][a-z-]+)/g)].map((m) => m[1]);
		expect(passed.length).toBeGreaterThan(5);
		const publish = receiptCommand().commands.find(
			(c) => c.name() === "publish",
		);
		const known = new Set(publish?.options.map((o) => o.long));
		for (const flag of passed) expect(known.has(flag)).toBe(true);
	});
});
