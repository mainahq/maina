/**
 * Test fixtures for the GitHub receipt surfaces: a receipt, the comment view
 * of it, and an in-memory GitHub REST API behind an `HttpPort`.
 */

import type { Receipt } from "../../receipt/types";
import type { HttpPort, HttpRequest } from "../http";
import type { CommentReceipt } from "../receipt-comment";

export const HEAD_SHA = "a".repeat(40);
export const REPO = "acme/widgets";

export function sampleReceipt(overrides: Partial<Receipt> = {}): Receipt {
	return {
		prTitle: "Add retry to the uploader",
		repo: REPO,
		timestamp: "2026-09-26T10:00:00.000Z",
		status: "passed",
		hash: "b".repeat(64),
		diff: { additions: 120, deletions: 8, files: 4 },
		agent: { id: "claude-code", modelVersion: "claude-opus-5-5" },
		promptVersion: {
			constitutionHash: "c".repeat(64),
			promptsHash: "d".repeat(64),
		},
		checks: [
			{
				id: "biome",
				name: "Biome",
				status: "passed",
				tool: "biome",
				findings: [],
			},
			{
				id: "tests",
				name: "Tests",
				status: "passed",
				tool: "tests",
				findings: [],
			},
			{
				id: "semgrep",
				name: "Semgrep",
				status: "skipped",
				tool: "semgrep",
				findings: [],
			},
		],
		walkthrough: "Adds a bounded retry loop to the uploader.",
		feedback: [],
		retries: 0,
		triage: {
			decisionId: "diff.needs_review:1234",
			needsReview: true,
			confidence: 0.87,
		},
		...overrides,
	};
}

export function sampleCommentReceipt(
	overrides: Partial<CommentReceipt> = {},
): CommentReceipt {
	return {
		...sampleReceipt(),
		criteria: [
			{
				id: "AC-1",
				text: "Uploads retry up to 3 times on a 5xx",
				status: "met",
				evidence: ["tests: uploader.test.ts:42", "check biome passed"],
			},
			{
				id: "AC-2",
				text: "A 4xx is not retried",
				status: "unverified",
				evidence: [],
			},
		],
		verifyScope: { kind: "range", base: "origin/main", files: 4 },
		gate: {
			blocked: 1,
			asked: 2,
			allowed: 14,
			overrides: [
				{
					decisionId: "action.risk:77",
					summary: "git push --force-with-lease",
				},
			],
		},
		url: "https://github.com/acme/widgets/actions/runs/99",
		...overrides,
	};
}

type StoredComment = { id: number; body: string; user: { login: string } };
type StoredCheck = {
	id: number;
	name: string;
	head_sha: string;
	conclusion: string;
	output: { title: string; summary: string };
};

type FakeGitHub = Readonly<{
	http: HttpPort;
	requests: HttpRequest[];
	comments: StoredComment[];
	checks: StoredCheck[];
	/** Pretend the token is read-only: every write answers 403. */
	setReadOnly: (readOnly: boolean) => void;
	/** Seed a comment as if someone had posted it earlier. */
	seedComment: (body: string, login?: string) => number;
}>;

const BOT = "github-actions[bot]";

/**
 * An in-memory slice of the GitHub REST API: issue comments (paginated) and
 * check runs, enough for the sticky comment and the check run upserts.
 */
export function fakeGitHub(options: { pageSize?: number } = {}): FakeGitHub {
	const pageSize = options.pageSize ?? 100;
	const requests: HttpRequest[] = [];
	const comments: StoredComment[] = [];
	const checks: StoredCheck[] = [];
	let nextId = 1000;
	let readOnly = false;

	const json = (status: number, body: unknown) =>
		({ ok: true, value: { status, body: JSON.stringify(body) } }) as const;

	const http: HttpPort = {
		request: async (req) => {
			requests.push(req);
			const url = new URL(req.url);
			const path = url.pathname;
			const write = req.method !== "GET";
			if (write && readOnly) {
				return json(403, {
					message: "Resource not accessible by integration",
				});
			}
			const body = req.body === undefined ? {} : JSON.parse(req.body);

			const list = path.match(
				/^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/,
			);
			if (list && req.method === "GET") {
				const perPage = Math.min(
					Number(url.searchParams.get("per_page") ?? 30),
					pageSize,
				);
				const page = Number(url.searchParams.get("page") ?? 1);
				return json(200, comments.slice((page - 1) * perPage, page * perPage));
			}
			if (list && req.method === "POST") {
				const comment = { id: nextId++, body: body.body, user: { login: BOT } };
				comments.push(comment);
				return json(201, comment);
			}
			const one = path.match(
				/^\/repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/,
			);
			if (one) {
				const id = Number(one[1]);
				const index = comments.findIndex((c) => c.id === id);
				if (index < 0) return json(404, { message: "Not Found" });
				if (req.method === "PATCH") {
					const found = comments[index];
					if (found) found.body = body.body;
					return json(200, found);
				}
				if (req.method === "DELETE") {
					comments.splice(index, 1);
					return { ok: true, value: { status: 204, body: "" } };
				}
			}
			const runs = path.match(
				/^\/repos\/[^/]+\/[^/]+\/commits\/([^/]+)\/check-runs$/,
			);
			if (runs && req.method === "GET") {
				const name = url.searchParams.get("check_name");
				const found = checks.filter(
					(c) => c.head_sha === runs[1] && (name === null || c.name === name),
				);
				return json(200, { total_count: found.length, check_runs: found });
			}
			if (
				path.match(/^\/repos\/[^/]+\/[^/]+\/check-runs$/) &&
				req.method === "POST"
			) {
				const check = { id: nextId++, ...body };
				checks.push(check);
				return json(201, check);
			}
			const run = path.match(/^\/repos\/[^/]+\/[^/]+\/check-runs\/(\d+)$/);
			if (run && req.method === "PATCH") {
				const found = checks.find((c) => c.id === Number(run[1]));
				if (!found) return json(404, { message: "Not Found" });
				Object.assign(found, body);
				return json(200, found);
			}
			return json(404, { message: `No route for ${req.method} ${path}` });
		},
	};

	return {
		http,
		requests,
		comments,
		checks,
		setReadOnly: (value) => {
			readOnly = value;
		},
		seedComment: (body, login = BOT) => {
			const id = nextId++;
			comments.push({ id, body, user: { login } });
			return id;
		},
	};
}

export function writes(requests: readonly HttpRequest[]): HttpRequest[] {
	return requests.filter((r) => r.method !== "GET");
}
