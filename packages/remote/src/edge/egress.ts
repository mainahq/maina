/**
 * The egress proxy of a self-hosted install (FR-REM-4): the only way out.
 *
 * The maina containers sit on a network with no route to the outside and
 * reach the internet through this proxy (`HTTPS_PROXY`), which bridges the
 * two networks. It opens HTTP CONNECT tunnels to an allow-list of exact
 * `host:port` destinations, GitHub (`GITHUB_HOSTS` on 443) unless the
 * operator names others, refuses everything else, and never forwards
 * plain HTTP. Every attempt is logged, allowed or not, so the log is the
 * audit of what the install contacted.
 *
 * The allow-list matches names, not addresses: an IP literal passes only
 * when it is itself on the list.
 */

import { connect, createServer, type Socket } from "node:net";
import type { Result } from "@mainahq/core";

/** GitHub's API and git endpoints: all a PR job needs. */
export const GITHUB_HOSTS = ["github.com", "api.github.com"] as const;

const HTTPS_PORT = 443;
/** A request head larger than this is not a proxy request. */
const MAX_HEAD_BYTES = 16 * 1024;
/** How long an allowed destination gets to accept the connection. */
const CONNECT_TIMEOUT_MS = 30_000;

type Destination = Readonly<{ host: string; port: number }>;

type AllowlistError = Readonly<{
	kind: "invalid_entry";
	entry: string;
	message: string;
}>;

/** One attempt to leave, as logged. */
export type EgressEvent = Readonly<{
	event: "egress";
	method: string;
	host: string;
	port: number;
	allowed: boolean;
}>;

type ProxyRequest = Readonly<{ method: string; host: string; port: number }>;

const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const HOSTNAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);
const IPV6 = /^[0-9a-f:.]+$/;

/** `host`, lower-cased, without a trailing dot or IPv6 brackets. */
const normalise = (host: string): string =>
	host
		.toLowerCase()
		.replace(/^\[(.*)\]$/, "$1")
		.replace(/\.$/, "");

const validHost = (host: string): boolean =>
	HOSTNAME.test(host) || (host.includes(":") && IPV6.test(host));

function parsePort(raw: string | undefined, fallback: number): number | null {
	if (raw === undefined) return fallback;
	if (!/^\d{1,5}$/.test(raw)) return null;
	const port = Number(raw);
	return port >= 1 && port <= 65_535 ? port : null;
}

/** `host`, `host:port`, `[v6]` or `[v6]:port`; `undefined` if malformed. */
function parseAuthority(
	authority: string,
	fallbackPort: number,
): Destination | undefined {
	const match = /^(\[[^\]]+\]|[^:[\]]+)(?::([^:]*))?$/.exec(authority);
	if (match === null) return undefined;
	const host = normalise(match[1] ?? "");
	const port = parsePort(match[2], fallbackPort);
	return validHost(host) && port !== null ? { host, port } : undefined;
}

/**
 * The allow-list from `MAINA_EGRESS_ALLOW`: comma-separated exact hosts,
 * each with an optional port (default 443). Empty or unset: GitHub.
 */
export function parseAllowlist(
	raw: string | undefined,
): Result<readonly Destination[], AllowlistError> {
	const entries = (raw ?? "")
		.split(",")
		.map((e) => e.trim())
		.filter((e) => e !== "");
	if (entries.length === 0) {
		return {
			ok: true,
			value: GITHUB_HOSTS.map((host) => ({ host, port: HTTPS_PORT })),
		};
	}
	const allow: Destination[] = [];
	for (const entry of entries) {
		const destination = parseAuthority(entry, HTTPS_PORT);
		if (destination === undefined) {
			return {
				ok: false,
				error: {
					kind: "invalid_entry",
					entry,
					message: `${JSON.stringify(entry)} is not a host or host:port (no schemes, paths or wildcards)`,
				},
			};
		}
		allow.push(destination);
	}
	return { ok: true, value: allow };
}

/** Whether `host:port` is exactly on the allow-list. */
export function egressAllowed(
	allow: readonly Destination[],
	host: string,
	port: number,
): boolean {
	const name = normalise(host);
	return allow.some((d) => d.host === name && d.port === port);
}

/**
 * Where a proxy request is going, from its request line: a CONNECT
 * authority, or the absolute URL of a plain-HTTP proxy request.
 */
export function parseProxyRequest(head: string): ProxyRequest | undefined {
	const line = head.split("\r\n", 1)[0] ?? "";
	const match = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(line);
	if (match === null) return undefined;
	const method = match[1] ?? "";
	const target = match[2] ?? "";
	if (method === "CONNECT") {
		// A tunnel names its port; there is no default to fall back on.
		if (!/:\d+$/.test(target)) return undefined;
		const destination = parseAuthority(target, HTTPS_PORT);
		return destination === undefined ? undefined : { method, ...destination };
	}
	if (!/^https?:\/\//i.test(target)) return undefined;
	try {
		const url = new URL(target);
		const destination = parseAuthority(
			url.host,
			url.protocol === "https:" ? HTTPS_PORT : 80,
		);
		return destination === undefined ? undefined : { method, ...destination };
	} catch {
		return undefined;
	}
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
	200: "OK",
	400: "Bad Request",
	403: "Forbidden",
	431: "Request Header Fields Too Large",
	502: "Bad Gateway",
	504: "Gateway Timeout",
};

function reply(socket: Socket, status: number, body: string): void {
	socket.end(
		`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? ""}\r\n` +
			"Content-Type: text/plain\r\n" +
			`Content-Length: ${Buffer.byteLength(body)}\r\n` +
			"Connection: close\r\n\r\n" +
			body,
	);
}

type EgressProxyOptions = Readonly<{
	port: number;
	/** Listen address; default all interfaces. */
	hostname?: string;
	allow: readonly Destination[];
	log: (event: EgressEvent) => void;
}>;

type EgressProxy = Readonly<{ port: number; stop: () => Promise<void> }>;

/** Opens the tunnel for an allowed CONNECT and splices the two sockets. */
function tunnel(client: Socket, to: Destination, early: Buffer): void {
	let established = false;
	const upstream = connect({ host: to.host, port: to.port });
	upstream.setTimeout(CONNECT_TIMEOUT_MS, () => {
		upstream.destroy();
		reply(client, 504, `${to.host}:${to.port} did not answer\n`);
	});
	upstream.on("connect", () => {
		established = true;
		upstream.setTimeout(0);
		client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
		if (early.length > 0) upstream.write(early);
		client.pipe(upstream);
		upstream.pipe(client);
	});
	upstream.on("error", () => {
		if (established) client.destroy();
		else reply(client, 502, `cannot reach ${to.host}:${to.port}\n`);
	});
	client.on("close", () => upstream.destroy());
}

/** Starts the proxy; resolves once it listens. */
export function startEgressProxy(
	options: EgressProxyOptions,
): Promise<EgressProxy> {
	const sockets = new Set<Socket>();

	function handle(client: Socket, head: string, early: Buffer): void {
		if (/^GET \/healthz HTTP\/1\.[01]$/.test(head.split("\r\n", 1)[0] ?? "")) {
			reply(client, 200, "ok\n");
			return;
		}
		const request = parseProxyRequest(head);
		if (request === undefined) {
			reply(client, 400, "not a proxy request\n");
			return;
		}
		const allowed =
			request.method === "CONNECT" &&
			egressAllowed(options.allow, request.host, request.port);
		options.log({
			event: "egress",
			method: request.method,
			host: request.host,
			port: request.port,
			allowed,
		});
		if (!allowed) {
			reply(
				client,
				403,
				request.method === "CONNECT"
					? `${request.host}:${request.port} is not on the egress allow-list\n`
					: "plain HTTP is never forwarded; use https\n",
			);
			return;
		}
		tunnel(client, request, early);
	}

	const server = createServer((client) => {
		sockets.add(client);
		client.on("close", () => sockets.delete(client));
		client.on("error", () => client.destroy());
		let buffered = Buffer.alloc(0);
		const onData = (chunk: Buffer) => {
			buffered = Buffer.concat([buffered, chunk]);
			const end = buffered.indexOf("\r\n\r\n");
			if (end < 0) {
				if (buffered.length > MAX_HEAD_BYTES) {
					client.off("data", onData);
					reply(client, 431, "request head too large\n");
				}
				return;
			}
			client.off("data", onData);
			// Hold anything the client sends next until the tunnel pipes it.
			client.pause();
			handle(
				client,
				buffered.subarray(0, end).toString("latin1"),
				buffered.subarray(end + 4),
			);
		};
		client.on("data", onData);
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port, options.hostname, () => {
			const address = server.address();
			resolve({
				port:
					typeof address === "object" && address !== null
						? address.port
						: options.port,
				stop: () =>
					new Promise<void>((done) => {
						for (const socket of sockets) socket.destroy();
						server.close(() => done());
					}),
			});
		});
	});
}
