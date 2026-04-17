/**
 * Sticky PR Comment — find-or-create a single root Maina comment per PR.
 *
 * Searches for `<!-- maina:run -->` marker in existing comments.
 * If found: updates the existing comment (preserves reactions).
 * If not found: creates a new comment.
 *
 * Race mitigation: create-then-deduplicate. After creating, re-list to check
 * for duplicates and delete ours if another run created one first.
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
	/** Comment body (marker will be prepended if missing) */
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
 * Ensure the body contains the marker. Prepends it if missing.
 */
function ensureMarker(body: string): string {
	if (body.includes("<!-- maina:run")) return body;
	return `${MARKER}\n${body}`;
}

/**
 * Find or create a sticky Maina comment on a PR.
 *
 * Race mitigation: if we create a comment, we re-list and delete ours if
 * another run's comment has a lower ID (first writer wins).
 *
 * Gracefully handles missing `issues:write` permission.
 */
export async function upsertStickyComment(
	options: StickyCommentOptions,
): Promise<Result<StickyCommentResult>> {
	const {
		token,
		owner,
		repo,
		prNumber,
		apiBase = "https://api.github.com",
	} = options;
	const body = ensureMarker(options.body);

	const headers = {
		Authorization: `token ${token}`,
		Accept: "application/vnd.github.v3+json",
		"Content-Type": "application/json",
		"User-Agent": "maina-verify",
	};

	try {
		// Search existing comments for the marker
		const findResult = await findMarkerComment(
			apiBase,
			owner,
			repo,
			prNumber,
			headers,
		);

		if (!findResult.ok) {
			return { ok: false, error: findResult.error };
		}

		if (findResult.value !== null) {
			// Update existing comment
			const existingId = findResult.value;
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
		const createUrl = `${apiBase}/repos/${owner}/${repo}/issues/${prNumber}/comments`;
		const createRes = await fetch(createUrl, {
			method: "POST",
			headers,
			body: JSON.stringify({ body }),
		});

		if (!createRes.ok) {
			const status = createRes.status;
			if (status === 403 || status === 404) {
				return {
					ok: false,
					error: `Missing permission: issues:write is required to post PR comments (${status})`,
				};
			}
			return {
				ok: false,
				error: `Failed to create comment: ${status} ${createRes.statusText}`,
			};
		}

		const created = (await createRes.json()) as { id: number };

		// Race mitigation: re-list to deduplicate
		const dedup = await findMarkerComment(
			apiBase,
			owner,
			repo,
			prNumber,
			headers,
		);
		if (dedup.ok && dedup.value !== null && dedup.value < created.id) {
			// Another run created a comment with a lower ID — delete ours, update theirs
			await fetch(
				`${apiBase}/repos/${owner}/${repo}/issues/comments/${created.id}`,
				{ method: "DELETE", headers },
			);
			await fetch(
				`${apiBase}/repos/${owner}/${repo}/issues/comments/${dedup.value}`,
				{ method: "PATCH", headers, body: JSON.stringify({ body }) },
			);
			return {
				ok: true,
				value: { commentId: dedup.value, action: "updated" },
			};
		}

		return {
			ok: true,
			value: { commentId: created.id, action: "created" },
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
 * if found, or null if no marker comment exists.
 * Returns an error Result on API failures instead of hiding them.
 */
async function findMarkerComment(
	apiBase: string,
	owner: string,
	repo: string,
	prNumber: number,
	headers: Record<string, string>,
): Promise<Result<number | null>> {
	let page = 1;
	const perPage = 100;

	while (true) {
		const url = `${apiBase}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=${perPage}&page=${page}`;
		const res = await fetch(url, { headers });

		if (!res.ok) {
			return {
				ok: false,
				error: `Failed to list PR comments: ${res.status} ${res.statusText}`,
			};
		}

		const comments = (await res.json()) as Array<{
			id: number;
			body: string;
		}>;
		if (comments.length === 0) return { ok: true, value: null };

		for (const comment of comments) {
			if (comment.body.includes("<!-- maina:run")) {
				return { ok: true, value: comment.id };
			}
		}

		if (comments.length < perPage) return { ok: true, value: null };
		page++;
	}
}
