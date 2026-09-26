/**
 * A network spy the smoke test preloads into the job process
 * (`bun --preload network-spy.ts ...`). Every outbound attempt the process
 * makes (fetch, raw TCP and TLS sockets, `Bun.connect`, DNS lookups) is
 * appended as one JSON line to `MAINA_NETWORK_SPY_LOG`, and any destination
 * not in `MAINA_NETWORK_SPY_ALLOW` (comma-separated `host` or `host:port`)
 * is refused on the spot, so a stray call fails loudly instead of leaving.
 * Unix sockets and loopback DNS names are local IPC, not network, and are
 * not recorded.
 */

import dns from "node:dns";
import { appendFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

type Attempt = Readonly<{
	api: string;
	host: string;
	port: number | null;
	allowed: boolean;
}>;

const logFile = process.env.MAINA_NETWORK_SPY_LOG;
const allow = new Set(
	(process.env.MAINA_NETWORK_SPY_ALLOW ?? "")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter((s) => s !== ""),
);

function record(api: string, host: string, port: number | null): boolean {
	const name = host.toLowerCase().replace(/^\[|\]$/g, "");
	const allowed =
		allow.has(name) || (port !== null && allow.has(`${name}:${port}`));
	const attempt: Attempt = { api, host: name, port, allowed };
	if (logFile !== undefined) {
		appendFileSync(logFile, `${JSON.stringify(attempt)}\n`);
	}
	return allowed;
}

const blocked = (host: string, port: number | null): Error =>
	new Error(
		`network spy: blocked ${host}${port === null ? "" : `:${port}`} (not GitHub)`,
	);

// ── fetch ───────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
const spiedFetch = (
	input: string | URL | Request,
	init?: RequestInit,
): Promise<Response> => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.protocol === "http:" || url.protocol === "https:") {
		const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
		if (!record("fetch", url.hostname, port)) {
			return Promise.reject(blocked(url.hostname, port));
		}
	}
	return realFetch(input, init);
};
globalThis.fetch = Object.assign(spiedFetch, realFetch);

// ── sockets ─────────────────────────────────────────────────────────────────

type ConnectTarget = { host: string; port: number | null } | undefined;

/** Where a `socket.connect(...)` / `tls.connect(...)` call is going. */
function target(args: readonly unknown[]): ConnectTarget {
	// `net.connect` hands the socket pre-normalised `[[options, cb]]`.
	if (Array.isArray(args[0])) return target(args[0]);
	const [first, second] = args;
	if (typeof first === "object" && first !== null) {
		const o = first as { path?: unknown; host?: unknown; port?: unknown };
		if (typeof o.path === "string") return undefined;
		return {
			host: typeof o.host === "string" ? o.host : "localhost",
			port: o.port === undefined ? null : Number(o.port),
		};
	}
	if (typeof first === "string" && !/^\d+$/.test(first)) return undefined;
	if (typeof first === "number" || typeof first === "string") {
		return {
			host: typeof second === "string" ? second : "localhost",
			port: Number(first),
		};
	}
	return undefined;
}

type Connect = (this: unknown, ...args: unknown[]) => unknown;

function spyOn(owner: object, key: string, api: string): void {
	const real = (owner as Record<string, Connect>)[key];
	if (typeof real !== "function") return;
	(owner as Record<string, Connect>)[key] = function (
		this: unknown,
		...args: unknown[]
	) {
		const to = target(args);
		if (to !== undefined && !record(api, to.host, to.port)) {
			throw blocked(to.host, to.port);
		}
		return real.apply(this, args);
	};
}

spyOn(net.Socket.prototype, "connect", "net.connect");
if (Object.hasOwn(tls.TLSSocket.prototype, "connect")) {
	spyOn(tls.TLSSocket.prototype, "connect", "tls.connect");
}
spyOn(tls, "connect", "tls.connect");

const realBunConnect = Bun.connect;
Bun.connect = ((options: {
	hostname?: string;
	port?: number;
	unix?: string;
}) => {
	if (options.unix === undefined) {
		const host = options.hostname ?? "localhost";
		const port = options.port ?? null;
		if (!record("Bun.connect", host, port)) throw blocked(host, port);
	}
	return realBunConnect(options as Parameters<typeof Bun.connect>[0]);
}) as typeof Bun.connect;

// ── node:http / node:https (Bun serves them without the global fetch) ─────

function spyRequest(owner: object, key: string, scheme: string): void {
	const real = (owner as Record<string, Connect>)[key];
	if (typeof real !== "function") return;
	(owner as Record<string, Connect>)[key] = function (
		this: unknown,
		...args: unknown[]
	) {
		const [first] = args;
		let host = "localhost";
		let port = scheme === "https" ? 443 : 80;
		if (typeof first === "string" || first instanceof URL) {
			const url = new URL(String(first));
			host = url.hostname;
			port = Number(url.port || port);
		} else if (typeof first === "object" && first !== null) {
			const o = first as { hostname?: unknown; host?: unknown; port?: unknown };
			const named = o.hostname ?? o.host;
			if (typeof named === "string") host = named.replace(/:\d+$/, "");
			if (o.port !== undefined) port = Number(o.port);
		}
		if (!record(`${scheme}.${key}`, host, port)) throw blocked(host, port);
		return real.apply(this, args);
	};
}

spyRequest(http, "request", "http");
spyRequest(http, "get", "http");
spyRequest(https, "request", "https");
spyRequest(https, "get", "https");

// ── DNS ─────────────────────────────────────────────────────────────────────

const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function spyLookup(owner: object, key: string, api: string): void {
	const real = (owner as Record<string, Connect>)[key];
	if (typeof real !== "function") return;
	(owner as Record<string, Connect>)[key] = function (
		this: unknown,
		...args: unknown[]
	) {
		const host = typeof args[0] === "string" ? args[0] : "";
		if (!LOCAL_NAMES.has(host) && !record(api, host, null)) {
			throw blocked(host, null);
		}
		return real.apply(this, args);
	};
}

spyLookup(dns, "lookup", "dns.lookup");
spyLookup(dns, "resolve", "dns.resolve");
spyLookup(dns, "resolve4", "dns.resolve");
spyLookup(dns, "resolve6", "dns.resolve");
spyLookup(dns.promises, "lookup", "dns.lookup");
spyLookup(dns.promises, "resolve", "dns.resolve");
spyLookup(Bun.dns, "lookup", "dns.lookup");
