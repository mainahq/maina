/**
 * CORS for browser-based MCP clients. The discovery documents, `/register`,
 * `/token` and `/mcp` answer any origin: every credential on them travels
 * in a header or body the caller sets itself (a bearer token, client
 * credentials, a PKCE verifier), never in a cookie, so a page on another
 * origin gains nothing it did not already hold. Credentialed CORS is never
 * allowed. `/authorize` is a top-level browser navigation and gets none.
 */

/** Request headers a browser MCP client sends on these routes. */
const ALLOW_HEADERS = [
	"authorization",
	"content-type",
	"accept",
	"mcp-protocol-version",
	"mcp-session-id",
	"last-event-id",
].join(", ");

/** Response headers a browser client must be able to read. */
const EXPOSE_HEADERS = [
	"www-authenticate",
	"mcp-session-id",
	"mcp-protocol-version",
].join(", ");

/** How long a browser may cache a preflight answer: one day. */
const MAX_AGE_SECONDS = 86_400;

/** `res` readable from any origin. The body is passed through untouched. */
export function withCors(res: Response): Response {
	const headers = new Headers(res.headers);
	headers.set("access-control-allow-origin", "*");
	headers.set("access-control-expose-headers", EXPOSE_HEADERS);
	return new Response(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers,
	});
}

/** The answer to a CORS preflight for a route serving `methods`. */
export function preflight(methods: readonly string[]): Response {
	return new Response(null, {
		status: 204,
		headers: {
			"access-control-allow-origin": "*",
			"access-control-allow-methods": [...methods, "OPTIONS"].join(", "),
			"access-control-allow-headers": ALLOW_HEADERS,
			"access-control-max-age": String(MAX_AGE_SECONDS),
		},
	});
}
