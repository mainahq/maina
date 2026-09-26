/**
 * A fake GitHub REST API for the App job tests: a `fetch` handler that
 * answers the handful of endpoints the jobs use (installation tokens, pull
 * requests, their files, the base/head merge base, token revocation) from in-memory state and records
 * every request, so a test can assert what the App asked GitHub for.
 */

export const API = "https://api.github.test";
export const INSTALLATION_ID = 4242;
export const APP_JWT = "app.jwt.signature";

type Recorded = Readonly<{
	method: string;
	path: string;
	authorization: string | null;
	body: unknown;
}>;

type FakePull = Readonly<{
	number: number;
	head: string;
	base: string;
	cloneUrl: string;
	/** Where head forked from base; default: `base` (the base did not move). */
	mergeBase?: string;
	files: readonly Readonly<{ filename: string; status: string }>[];
}>;

type FakeGitHub = Readonly<{
	fetch: (req: Request) => Promise<Response>;
	requests: Recorded[];
	/** Installation tokens minted and not revoked. */
	liveTokens: () => readonly string[];
}>;

const json = (status: number, body: unknown): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

export function fakeGitHub(
	options: Readonly<{
		owner?: string;
		repo?: string;
		pulls?: readonly FakePull[];
		/** Page size the files endpoint honours at most. */
		maxPerPage?: number;
	}> = {},
): FakeGitHub {
	const owner = options.owner ?? "acme";
	const repo = options.repo ?? "widgets";
	const pulls = options.pulls ?? [];
	const maxPerPage = options.maxPerPage ?? 100;
	const requests: Recorded[] = [];
	const tokens = new Set<string>();
	let minted = 0;

	const repoPath = `/repos/${owner}/${repo}`;

	async function handle(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const authorization = req.headers.get("authorization");
		const text = req.method === "GET" ? "" : await req.text();
		requests.push({
			method: req.method,
			path: url.pathname + url.search,
			authorization,
			body: text === "" ? undefined : JSON.parse(text),
		});
		if (url.origin !== API) return json(404, { message: "Not Found" });

		if (
			req.method === "POST" &&
			url.pathname === `/app/installations/${INSTALLATION_ID}/access_tokens`
		) {
			if (authorization !== `Bearer ${APP_JWT}`) {
				return json(401, { message: "A JSON web token could not be decoded" });
			}
			minted += 1;
			const token = `ghs_fake_${minted}`;
			tokens.add(token);
			const body = JSON.parse(text) as { permissions?: unknown };
			return json(201, {
				token,
				expires_at: "2026-09-26T12:00:00Z",
				permissions: body.permissions ?? { metadata: "read" },
			});
		}

		if (req.method === "DELETE" && url.pathname === "/installation/token") {
			const token = authorization?.replace(/^Bearer /, "") ?? "";
			if (!tokens.delete(token)) return json(401, { message: "Bad token" });
			return new Response(null, { status: 204 });
		}

		const token = authorization?.replace(/^Bearer /, "") ?? "";
		if (!tokens.has(token)) {
			return json(401, { message: "Bad credentials" });
		}

		const pullMatch = new RegExp(`^${repoPath}/pulls/(\\d+)(/files)?$`).exec(
			url.pathname,
		);
		if (req.method === "GET" && pullMatch !== null) {
			const pull = pulls.find((p) => p.number === Number(pullMatch[1]));
			if (pull === undefined) return json(404, { message: "Not Found" });
			if (pullMatch[2] === undefined) {
				return json(200, {
					number: pull.number,
					head: { sha: pull.head },
					base: { sha: pull.base, repo: { clone_url: pull.cloneUrl } },
				});
			}
			const perPage = Math.min(
				Number(url.searchParams.get("per_page") ?? "30"),
				maxPerPage,
			);
			const page = Number(url.searchParams.get("page") ?? "1");
			return json(200, pull.files.slice((page - 1) * perPage, page * perPage));
		}

		const compareMatch = new RegExp(
			`^${repoPath}/compare/([0-9a-f]+)\\.\\.\\.([0-9a-f]+)$`,
		).exec(url.pathname);
		if (req.method === "GET" && compareMatch !== null) {
			const pull = pulls.find(
				(p) => p.base === compareMatch[1] && p.head === compareMatch[2],
			);
			if (pull === undefined) return json(404, { message: "Not Found" });
			return json(200, {
				merge_base_commit: { sha: pull.mergeBase ?? pull.base },
			});
		}
		return json(404, { message: "Not Found" });
	}

	return {
		fetch: handle,
		requests,
		liveTokens: () => [...tokens],
	};
}
