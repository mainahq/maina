/**
 * The ingress forwarder: in the compose deployment the remote service sits
 * on a network with no route out, which also means no published port, so
 * a forwarder on both networks carries inbound requests to it. It passes
 * requests through unchanged (method, path, query, headers, body) and
 * streams responses, which the Streamable HTTP transport's SSE needs.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { ingressHandler } from "../ingress";

type Seen = {
	method: string;
	path: string;
	authorization: string | null;
	body: string;
};

const servers: Array<{ stop: (force?: boolean) => unknown }> = [];
afterEach(() => {
	for (const s of servers.splice(0)) s.stop(true);
});

function upstream(): { url: string; seen: Seen[] } {
	const seen: Seen[] = [];
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		idleTimeout: 0,
		fetch: async (req) => {
			const url = new URL(req.url);
			seen.push({
				method: req.method,
				path: url.pathname + url.search,
				authorization: req.headers.get("authorization"),
				body: await req.text(),
			});
			if (url.pathname === "/sse") {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("data: first\n\n"));
						timer = setTimeout(() => {
							controller.enqueue(new TextEncoder().encode("data: late\n\n"));
							controller.close();
						}, 300);
					},
					cancel() {
						clearTimeout(timer);
					},
				});
				return new Response(stream, {
					headers: { "content-type": "text/event-stream" },
				});
			}
			return new Response(JSON.stringify({ ok: true }), {
				status: 201,
				headers: { "content-type": "application/json", "x-upstream": "yes" },
			});
		},
	});
	servers.push(server);
	return { url: `http://127.0.0.1:${server.port}`, seen };
}

describe("ingressHandler", () => {
	test("forwards method, path, query, headers and body; returns the answer as is", async () => {
		const up = upstream();
		const handle = ingressHandler(up.url);
		const res = await handle(
			new Request("https://maina.example.com/token?x=1", {
				method: "POST",
				headers: { authorization: "Bearer abc", "content-type": "text/plain" },
				body: "grant=1",
			}),
		);
		expect(res.status).toBe(201);
		expect(res.headers.get("x-upstream")).toBe("yes");
		expect(await res.json()).toEqual({ ok: true });
		expect(up.seen).toEqual([
			{
				method: "POST",
				path: "/token?x=1",
				authorization: "Bearer abc",
				body: "grant=1",
			},
		]);
	});

	test("streams a response: the first event arrives before the upstream finishes", async () => {
		const up = upstream();
		const handle = ingressHandler(up.url);
		const res = await handle(new Request("https://maina.example.com/sse"));
		const reader = res.body?.getReader();
		expect(reader).toBeDefined();
		if (reader === undefined) return;
		const started = performance.now();
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toContain("data: first");
		expect(performance.now() - started).toBeLessThan(250);
		await reader.cancel();
	});

	test("an unreachable upstream is a 502, never a throw", async () => {
		const up = upstream();
		for (const s of servers.splice(0)) s.stop(true);
		const handle = ingressHandler(up.url);
		const res = await handle(new Request("https://maina.example.com/healthz"));
		expect(res.status).toBe(502);
	});
});
