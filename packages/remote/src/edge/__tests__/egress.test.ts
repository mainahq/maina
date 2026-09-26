/**
 * The egress proxy (FR-REM-4): the only way out of a self-hosted install.
 * The maina containers sit on a network with no route out; this proxy
 * bridges to the outside and tunnels (HTTP CONNECT) to an allow-list that
 * is GitHub and nothing else by default. Every attempt, allowed or not, is
 * logged, so the log doubles as the audit of what the install contacted.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { connect, createServer, type Server, type Socket } from "node:net";
import {
	type EgressEvent,
	egressAllowed,
	GITHUB_HOSTS,
	parseAllowlist,
	parseProxyRequest,
	startEgressProxy,
} from "../egress";

describe("parseAllowlist", () => {
	test("defaults to GitHub over https, nothing else", () => {
		expect(parseAllowlist(undefined)).toEqual({
			ok: true,
			value: GITHUB_HOSTS.map((host) => ({ host, port: 443 })),
		});
		expect(parseAllowlist("  ")).toEqual(parseAllowlist(undefined));
		expect(GITHUB_HOSTS).toEqual(["github.com", "api.github.com"]);
	});

	test("takes hosts and host:port pairs, lower-cased", () => {
		expect(parseAllowlist("GHE.example.com, api.ghe.example.com:8443")).toEqual(
			{
				ok: true,
				value: [
					{ host: "ghe.example.com", port: 443 },
					{ host: "api.ghe.example.com", port: 8443 },
				],
			},
		);
	});

	for (const bad of [
		"*.github.com",
		"https://github.com",
		"github.com/path",
		"github.com:0",
		"github.com:99999",
		"github.com:https",
		"exa mple.com",
	]) {
		test(`refuses ${JSON.stringify(bad)}: an entry is one exact host`, () => {
			const parsed = parseAllowlist(bad);
			expect(parsed.ok).toBe(false);
			if (parsed.ok) return;
			expect(parsed.error).toEqual({
				kind: "invalid_entry",
				entry: bad.trim(),
				message: expect.any(String),
			});
		});
	}
});

describe("egressAllowed", () => {
	const allow = [
		{ host: "github.com", port: 443 },
		{ host: "api.github.com", port: 443 },
	];

	test("an exact host and port on the list", () => {
		expect(egressAllowed(allow, "api.github.com", 443)).toBe(true);
		expect(egressAllowed(allow, "API.GitHub.com.", 443)).toBe(true);
	});

	test("anything else is denied", () => {
		expect(egressAllowed(allow, "api.github.com", 80)).toBe(false);
		expect(egressAllowed(allow, "evil.github.com", 443)).toBe(false);
		expect(egressAllowed(allow, "github.com.evil.test", 443)).toBe(false);
		expect(egressAllowed(allow, "openrouter.ai", 443)).toBe(false);
		expect(egressAllowed(allow, "140.82.112.3", 443)).toBe(false);
	});
});

describe("parseProxyRequest", () => {
	test("a CONNECT tunnel request", () => {
		expect(
			parseProxyRequest(
				"CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443",
			),
		).toEqual({ method: "CONNECT", host: "api.github.com", port: 443 });
	});

	test("a bracketed IPv6 literal", () => {
		expect(parseProxyRequest("CONNECT [::1]:443 HTTP/1.1")).toEqual({
			method: "CONNECT",
			host: "::1",
			port: 443,
		});
	});

	test("a plain-HTTP proxy request names its destination too", () => {
		expect(
			parseProxyRequest("GET http://example.com/x HTTP/1.1\r\nHost: x"),
		).toEqual({ method: "GET", host: "example.com", port: 80 });
	});

	test("garbage is undefined", () => {
		expect(parseProxyRequest("hello")).toBeUndefined();
		expect(parseProxyRequest("CONNECT nohost HTTP/1.1")).toBeUndefined();
		expect(parseProxyRequest("GET /relative HTTP/1.1")).toBeUndefined();
	});
});

describe("startEgressProxy", () => {
	const cleanup: Array<() => Promise<void> | void> = [];
	afterEach(async () => {
		for (const fn of cleanup.splice(0).reverse()) await fn();
	});

	/** A TCP echo server standing in for an allowed destination. */
	async function echoServer(): Promise<{
		port: number;
		accepted: () => number;
	}> {
		let accepted = 0;
		const server: Server = createServer((socket) => {
			accepted += 1;
			socket.pipe(socket);
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		cleanup.push(
			() => new Promise<void>((resolve) => server.close(() => resolve())),
		);
		const address = server.address();
		if (address === null || typeof address === "string") {
			throw new Error("no port");
		}
		return { port: address.port, accepted: () => accepted };
	}

	/** Sends `head` to the proxy and collects what comes back until `until` matches. */
	function exchange(
		port: number,
		head: string,
		then?: (socket: Socket) => void,
		until: RegExp = /\r\n\r\n/,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const socket = connect(port, "127.0.0.1");
			let received = "";
			let sentTail = false;
			const timer = setTimeout(() => {
				socket.destroy();
				resolve(received);
			}, 2000);
			socket.on("data", (chunk) => {
				received += chunk.toString();
				if (!sentTail && then !== undefined && /\r\n\r\n/.test(received)) {
					sentTail = true;
					then(socket);
					return;
				}
				if (until.test(received)) {
					clearTimeout(timer);
					socket.destroy();
					resolve(received);
				}
			});
			socket.on("close", () => {
				clearTimeout(timer);
				resolve(received);
			});
			socket.on("error", reject);
			socket.write(head);
		});
	}

	async function proxy(allow: ReturnType<typeof parseAllowlist>) {
		if (!allow.ok) throw new Error(allow.error.message);
		const events: EgressEvent[] = [];
		const started = await startEgressProxy({
			port: 0,
			hostname: "127.0.0.1",
			allow: allow.value,
			log: (event) => events.push(event),
		});
		cleanup.push(started.stop);
		return { port: started.port, events };
	}

	test("tunnels to an allowed destination and logs it", async () => {
		const echo = await echoServer();
		const { port, events } = await proxy(
			parseAllowlist(`127.0.0.1:${echo.port}`),
		);
		const reply = await exchange(
			port,
			`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`,
			(socket) => socket.write("ping"),
			/ping/,
		);
		expect(reply).toStartWith("HTTP/1.1 200 ");
		expect(reply).toEndWith("ping");
		expect(echo.accepted()).toBe(1);
		expect(events).toEqual([
			{
				event: "egress",
				method: "CONNECT",
				host: "127.0.0.1",
				port: echo.port,
				allowed: true,
			},
		]);
	});

	test("refuses a destination off the list without connecting, and logs it", async () => {
		const echo = await echoServer();
		const { port, events } = await proxy(parseAllowlist(undefined));
		const reply = await exchange(
			port,
			`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\n\r\n`,
		);
		expect(reply).toStartWith("HTTP/1.1 403 ");
		expect(echo.accepted()).toBe(0);
		expect(events).toEqual([
			{
				event: "egress",
				method: "CONNECT",
				host: "127.0.0.1",
				port: echo.port,
				allowed: false,
			},
		]);
	});

	test("refuses plain-HTTP forwarding even to an allowed host", async () => {
		const { port, events } = await proxy(parseAllowlist("github.com:80"));
		const reply = await exchange(
			port,
			"GET http://github.com/ HTTP/1.1\r\nHost: github.com\r\n\r\n",
		);
		expect(reply).toStartWith("HTTP/1.1 403 ");
		expect(events).toEqual([
			{
				event: "egress",
				method: "GET",
				host: "github.com",
				port: 80,
				allowed: false,
			},
		]);
	});

	test("answers its own /healthz (the image's health check) and logs nothing", async () => {
		const { port, events } = await proxy(parseAllowlist(undefined));
		const reply = await exchange(
			port,
			"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
		);
		expect(reply).toStartWith("HTTP/1.1 200 ");
		expect(events).toEqual([]);
	});

	test("answers a malformed request with 400 and logs nothing", async () => {
		const { port, events } = await proxy(parseAllowlist(undefined));
		const reply = await exchange(port, "nonsense\r\n\r\n");
		expect(reply).toStartWith("HTTP/1.1 400 ");
		expect(events).toEqual([]);
	});

	test("answers 502 when an allowed destination cannot be reached", async () => {
		const echo = await echoServer();
		const dead = echo.port;
		for (const fn of cleanup.splice(0)) await fn();
		const { port } = await proxy(parseAllowlist(`127.0.0.1:${dead}`));
		const reply = await exchange(
			port,
			`CONNECT 127.0.0.1:${dead} HTTP/1.1\r\n\r\n`,
		);
		expect(reply).toStartWith("HTTP/1.1 502 ");
	});
});
