/**
 * The ingress forwarder of the compose deployment (FR-REM-4). The remote
 * service sits on a network with no route out, which also leaves it with
 * no published port; this forwarder, on both networks, carries inbound
 * requests to it. Requests pass through as they came (method, path,
 * query, end-to-end headers, body) and responses stream back byte for
 * byte, as the Streamable HTTP transport's SSE needs. It never follows
 * redirects and never reaches anything but its one upstream.
 */

/**
 * Connection-scoped headers a forwarder must not pass on (RFC 9110 §7.6.1),
 * plus `host`, which names the forwarder rather than the upstream.
 */
const HOP_BY_HOP = [
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"proxy-connection",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"host",
];

type Fetch = (req: Request) => Promise<Response>;

/**
 * The upstream's bytes as they came: Bun's fetch would otherwise decode a
 * compressed body but keep its `content-encoding`, and the client would
 * then fail to decode it a second time.
 */
const passThrough: Fetch = (req) => fetch(req, { decompress: false });

/** `source` without the hop-by-hop headers, or those its `Connection` names. */
function endToEnd(source: Headers): Headers {
	const headers = new Headers(source);
	const named = (source.get("connection") ?? "")
		.split(",")
		.map((name) => name.trim().toLowerCase())
		.filter((name) => name !== "");
	for (const name of [...HOP_BY_HOP, ...named]) headers.delete(name);
	return headers;
}

export function ingressHandler(
	upstream: string,
	fetchImpl: Fetch = passThrough,
): (req: Request) => Promise<Response> {
	const base = new URL(upstream);
	return async (req) => {
		const url = new URL(req.url);
		const target = new URL(`${url.pathname}${url.search}`, base);
		const hasBody = req.method !== "GET" && req.method !== "HEAD";
		try {
			return await fetchImpl(
				new Request(target, {
					method: req.method,
					headers: endToEnd(req.headers),
					redirect: "manual",
					...(hasBody ? { body: req.body, duplex: "half" } : {}),
				}),
			);
		} catch {
			return new Response("upstream unavailable\n", {
				status: 502,
				headers: { "content-type": "text/plain" },
			});
		}
	};
}
