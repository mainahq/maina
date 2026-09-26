/**
 * One sticky PR comment, found by a hidden marker and updated in place.
 *
 * Every publish lists the PR's comments (all pages), keeps the oldest one
 * that starts with the marker (and, when given, was written by `author`),
 * updates it, and deletes any later duplicate a race left behind. An
 * unchanged body sends no write at all.
 */

import type { Result } from "../db/index";
import {
	type GitHubAuth,
	type GitHubError,
	githubRequest,
	type HttpPort,
} from "./http";

type StickyTarget = Readonly<{ repo: string; number: number }>;

type StickyCommentInput = Readonly<{
	http: HttpPort;
	auth: GitHubAuth;
	pr: StickyTarget;
	/** Hidden marker, e.g. `<!-- maina:receipt v2 -->`; `body` must start with it. */
	marker: string;
	body: string;
	/** Only a comment by this login counts, so nobody can hijack the slot. */
	author?: string;
}>;

type StickyCommentResult = Readonly<{
	id: number;
	action: "created" | "updated" | "unchanged";
}>;

type IssueComment = Readonly<{ id: number; body: string; login: string }>;

const PER_PAGE = 100;
/** 100 pages of 100 comments is far past any real PR; stop runaway paging. */
const MAX_PAGES = 100;

export async function upsertStickyComment(
	input: StickyCommentInput,
): Promise<Result<StickyCommentResult, GitHubError>> {
	const { http, auth, pr, marker, body } = input;
	const listed = await listComments(http, auth, pr);
	if (!listed.ok) return listed;

	const mine = listed.value.filter(
		(c) =>
			c.body.startsWith(marker) &&
			(input.author === undefined || c.login === input.author),
	);
	const [keep, ...duplicates] = mine;

	for (const duplicate of duplicates) {
		const removed = await githubRequest(
			http,
			auth,
			"DELETE",
			`/repos/${pr.repo}/issues/comments/${duplicate.id}`,
		);
		if (!removed.ok) return removed;
	}

	if (keep === undefined) {
		const created = await githubRequest(
			http,
			auth,
			"POST",
			`/repos/${pr.repo}/issues/${pr.number}/comments`,
			{ body },
		);
		if (!created.ok) return created;
		const id = idOf(created.value);
		return id === undefined
			? badResponse("created comment has no id")
			: { ok: true, value: { id, action: "created" } };
	}

	if (keep.body === body) {
		return { ok: true, value: { id: keep.id, action: "unchanged" } };
	}
	const updated = await githubRequest(
		http,
		auth,
		"PATCH",
		`/repos/${pr.repo}/issues/comments/${keep.id}`,
		{ body },
	);
	if (!updated.ok) return updated;
	return { ok: true, value: { id: keep.id, action: "updated" } };
}

async function listComments(
	http: HttpPort,
	auth: GitHubAuth,
	pr: StickyTarget,
): Promise<Result<readonly IssueComment[], GitHubError>> {
	const all: IssueComment[] = [];
	let firstPageLength = 0;
	for (let page = 1; page <= MAX_PAGES; page++) {
		const res = await githubRequest(
			http,
			auth,
			"GET",
			`/repos/${pr.repo}/issues/${pr.number}/comments?per_page=${PER_PAGE}&page=${page}`,
		);
		if (!res.ok) return res;
		if (!Array.isArray(res.value)) {
			return badResponse("comment list is not an array");
		}
		for (const raw of res.value) {
			const comment = asComment(raw);
			if (comment !== undefined) all.push(comment);
		}
		// An empty page, or one shorter than the first, is the last. The first
		// page's length (not PER_PAGE) is the yardstick, because a server may
		// cap per_page lower than asked.
		const length = res.value.length;
		if (page === 1) firstPageLength = length;
		if (length === 0 || length < firstPageLength) break;
	}
	return { ok: true, value: all };
}

function asComment(raw: unknown): IssueComment | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const r = raw as { id?: unknown; body?: unknown; user?: { login?: unknown } };
	if (typeof r.id !== "number") return undefined;
	return {
		id: r.id,
		body: typeof r.body === "string" ? r.body : "",
		login: typeof r.user?.login === "string" ? r.user.login : "",
	};
}

function idOf(value: unknown): number | undefined {
	const id = (value as { id?: unknown } | null)?.id;
	return typeof id === "number" ? id : undefined;
}

function badResponse(message: string): Result<never, GitHubError> {
	return { ok: false, error: { kind: "bad_response", message } };
}
