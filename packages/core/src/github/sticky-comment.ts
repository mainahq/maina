/**
 * Sticky PR Comment — find-or-create a single root Maina comment per PR.
 *
 * Searches for `<!-- maina:run -->` marker in existing comments.
 * If found: updates the existing comment (preserves reactions).
 * If not found: creates a new comment.
 *
 * Race-safe: concurrent CI runs on the same PR will find and update
 * the same comment via the marker, not create duplicates.
 */

import type { Result } from "../db/index";

const MARKER = "<!-- maina:run -->";

export interface StickyCommentOptions {
	/** GitHub token (GITHUB_TOKEN or PAT) */
	token: string;
	/** Repository owner */
	owner: string;
	/** Repository name */
	repo: string;
	/** Pull request number */
	prNumber: number;
	/** Comment body (must include the marker) */
	body: string;
	/** GitHub API base URL (default: https://api.github.com) */
	apiBase?: string;
}

export interface StickyCommentResult {
	/** The comment ID (for future updates) */
	commentId: number;
	/** Whether this was a new comment or an update */
	action: "created" | "updated";
}

/**
 * Build the comment body with the Maina marker.
 */
export function buildCommentBody(content: string, runId?: string): string {
	const markerLine = runId ? `<!-- maina:run id=${runId} -->` : MARKER;
	return `${markerLine}\n${content}`;
}

/**
 * Find or create a sticky Maina comment on a PR.
 *
 * Gracefully handles missing `issues:write` permission by returning
 * an error result instead of throwing.
 */
export async function upsertStickyComment(
	options: StickyCommentOptions,
): Promise<Result<StickyCommentResult>> {
	const {
		token,
		owner,
		repo,
		prNumber,
		body,
		apiBase = "https://api.github.com",
	} = options;

	const headers = {
		Authorization: `token ${token}`,
		Accept: "application/vnd.github.v3+json",
		"Content-Type": "application/json",
		"User-Agent": "maina-verify",
	};

	try {
		// Search existing comments for the marker
		const existingId = await findMarkerComment(
			apiBase,
			owner,
			repo,
			prNumber,
			headers,
		);

		if (existingId !== null) {
			// Update existing comment
			const url = `${apiBase}/repos/${owner}/${repo}/issues/comments/${existingId}`;
			const res = await fetch(url, {
				method: "PATCH",
				headers,
				body: JSON.stringify({ body }),
			});

			if (!res.ok) {
				return {
					ok: false,
					error: `Failed to update comment: ${res.status} ${res.statusText}`,
				};
			}

			return {
				ok: true,
				value: { commentId: existingId, action: "updated" },
			};
		}

		// Create new comment
		const url = `${apiBase}/repos/${owner}/${repo}/issues/${prNumber}/comments`;
		const res = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify({ body }),
		});

		if (!res.ok) {
			const status = res.status;
			if (status === 403 || status === 404) {
				return {
					ok: false,
					error: `Missing permission: issues:write is required to post PR comments (${status})`,
				};
			}
			return {
				ok: false,
				error: `Failed to create comment: ${status} ${res.statusText}`,
			};
		}

		const data = (await res.json()) as { id: number };
		return {
			ok: true,
			value: { commentId: data.id, action: "created" },
		};
	} catch (e) {
		return {
			ok: false,
			error: `GitHub API error: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

/**
 * Search PR comments for the maina:run marker. Returns the comment ID
 * if found, null otherwise. Paginates through all comments.
 */
async function findMarkerComment(
	apiBase: string,
	owner: string,
	repo: string,
	prNumber: number,
	headers: Record<string, string>,
): Promise<number | null> {
	let page = 1;
	const perPage = 100;

	while (true) {
		const url = `${apiBase}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=${perPage}&page=${page}`;
		const res = await fetch(url, { headers });
		if (!res.ok) return null;

		const comments = (await res.json()) as Array<{
			id: number;
			body: string;
		}>;
		if (comments.length === 0) return null;

		for (const comment of comments) {
			if (comment.body.includes("<!-- maina:run")) {
				return comment.id;
			}
		}

		if (comments.length < perPage) return null;
		page++;
	}
}
