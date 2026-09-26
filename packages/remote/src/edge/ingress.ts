/**
 * The ingress forwarder of the compose deployment (FR-REM-4). The remote
 * service sits on a network with no route out, which also leaves it with
 * no published port; this forwarder, on both networks, carries inbound
 * requests to it. Requests pass through as they came (method, path,
 * query, headers, body) and responses stream back, as the Streamable HTTP
 * transport's SSE needs. It never follows redirects and never reaches
 * anything but its one upstream.
 */

/** Connection-scoped headers a forwarder must not pass on (RFC 9110 §7.6.1). */
const HOP_BY_HOP = [
	"connection",
	"keep-alive",
	"proxy-connection",
	"transfer-encoding",
	"upgrade",
	"host",
];

type Fetch = (req: Request) => Promise<Response>;

export function ingressHandler(
	upstream: string,
	fetchImpl: Fetch = (req) => fetch(req),
): (req: Request) => Promise<Response> {
	const base = new URL(upstream);
	return async (req) => {
		const url = new URL(req.url);
		const target = new URL(`${url.pathname}${url.search}`, base);
		const headers = new Headers(req.headers);
		for (const name of HOP_BY_HOP) headers.delete(name);
		const hasBody = req.method !== "GET" && req.method !== "HEAD";
		try {
			return await fetchImpl(
				new Request(target, {
					method: req.method,
					headers,
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
