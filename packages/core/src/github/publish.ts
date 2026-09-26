/**
 * Publish a receipt to its PR (FR-RET-3): exactly one sticky comment and one
 * check run on the head commit, both updated in place on every republish.
 *
 * - Opt-in only: without `optIn` nothing is requested at all.
 * - Fork PRs: the workflow token is read-only there, so nothing is written.
 *   The outcome is a `fallback` carrying the markdown, which the Action
 *   writes to its job summary: the job's own check run on the PR then shows
 *   the receipt. A write refused mid-publish (403) falls back the same way.
 */

import type { Result } from "../db/index";
import { conclusionFor, upsertCheckRun } from "./checks";
import {
	type GitHubAuth,
	type GitHubError,
	type HttpPort,
	isRepoSlug,
} from "./http";
import {
	type CommentReceipt,
	RECEIPT_COMMENT_MARKER,
	receiptHeadline,
	renderReceiptComment,
} from "./receipt-comment";
import { upsertStickyComment } from "./sticky-comment";

/** The name the receipt check run carries on the head commit. */
const RECEIPT_CHECK_NAME = "maina/receipt";

export type PublishTarget = Readonly<{
	/** Base repository, `owner/name`. */
	repo: string;
	number: number;
	/** PR head commit the check run attaches to. */
	headSha: string;
}>;

export type PublishInput = Readonly<{
	pr: PublishTarget;
	receipt: CommentReceipt;
	auth: GitHubAuth;
	http: HttpPort;
	/** The repository opted in (the Action's `pr-comment` input). */
	optIn: boolean;
	discoveryLine?: boolean;
	/** Only a sticky comment by this login is updated. */
	author?: string;
}>;

export type PublishOutcome =
	| Readonly<{ kind: "skipped"; reason: "not_opted_in" }>
	| Readonly<{
			kind: "published";
			commentId: number;
			checkRunId: number;
			comment: "created" | "updated" | "unchanged";
			check: "created" | "updated";
	  }>
	| Readonly<{
			kind: "fallback";
			reason: "read_only_token" | "forbidden";
			/** The comment body, for the job summary. */
			markdown: string;
	  }>;

export type PublishError =
	| Readonly<{ kind: "invalid_input"; message: string }>
	| GitHubError;

export async function publishReceipt(
	input: PublishInput,
): Promise<Result<PublishOutcome, PublishError>> {
	if (!input.optIn) {
		return { ok: true, value: { kind: "skipped", reason: "not_opted_in" } };
	}
	const invalid = validate(input.pr);
	if (invalid !== undefined) {
		return { ok: false, error: { kind: "invalid_input", message: invalid } };
	}

	const { pr, receipt, auth, http } = input;
	const markdown = renderReceiptComment(receipt, {
		discoveryLine: input.discoveryLine ?? false,
	});
	const fallback = (reason: "read_only_token" | "forbidden") =>
		({ ok: true, value: { kind: "fallback", reason, markdown } }) as const;

	if (auth.readOnly) return fallback("read_only_token");

	const comment = await upsertStickyComment({
		http,
		auth,
		pr,
		marker: RECEIPT_COMMENT_MARKER,
		body: markdown,
		...(input.author === undefined ? {} : { author: input.author }),
	});
	if (!comment.ok) {
		return comment.error.kind === "forbidden" ? fallback("forbidden") : comment;
	}

	const detailsUrl = safeDetailsUrl(receipt.url);
	const check = await upsertCheckRun({
		http,
		auth,
		repo: pr.repo,
		check: {
			name: RECEIPT_CHECK_NAME,
			headSha: pr.headSha,
			conclusion: conclusionFor(receipt.status),
			title: receiptHeadline(receipt),
			summary: markdown,
			...(detailsUrl === undefined ? {} : { detailsUrl }),
		},
	});
	if (!check.ok) {
		return check.error.kind === "forbidden" ? fallback("forbidden") : check;
	}

	return {
		ok: true,
		value: {
			kind: "published",
			commentId: comment.value.id,
			checkRunId: check.value.id,
			comment: comment.value.action,
			check: check.value.action,
		},
	};
}

function validate(pr: PublishTarget): string | undefined {
	if (!isRepoSlug(pr.repo)) return `repo must be owner/name, got "${pr.repo}"`;
	if (!Number.isInteger(pr.number) || pr.number <= 0) {
		return `PR number must be a positive integer, got ${pr.number}`;
	}
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(pr.headSha)) {
		return `head sha must be a full commit sha, got "${pr.headSha}"`;
	}
	return undefined;
}

function safeDetailsUrl(url: string | undefined): string | undefined {
	return url !== undefined && /^https:\/\/\S+$/i.test(url) ? url : undefined;
}
