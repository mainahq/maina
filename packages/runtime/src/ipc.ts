/**
 * Runtime IPC protocol, version 1 (ADR 0044).
 *
 * Newline-delimited JSON over a Unix socket (a named pipe on Windows). Each
 * line is one message. A request names one of the five runtime methods and
 * carries the client's version; every response carries the runtime's version,
 * so either side can detect a mismatch. The runtime answers a request from a
 * client of another version (or protocol) with `version_mismatch`.
 *
 *   → {"v":1,"id":"…","method":"hook.evaluate","clientVersion":"2.0.0","params":{…}}
 *   ← {"v":1,"id":"…","runtimeVersion":"2.0.0","ok":true,"result":{…}}
 *   ← {"v":1,"id":"…","runtimeVersion":"2.0.0","ok":false,"error":{"code":"…","message":"…"}}
 */

import type { Result } from "@mainahq/core";
import type { Socket } from "bun";

export const PROTOCOL_VERSION = 1;

export const METHODS = [
	"hook.evaluate",
	"decide",
	"graph.query",
	"verify.run",
	"status",
] as const;
export type Method = (typeof METHODS)[number];

export type Request = Readonly<{
	v: typeof PROTOCOL_VERSION;
	id: string;
	method: Method;
	clientVersion: string;
	params?: unknown;
}>;

export type RpcErrorCode =
	| "bad_request"
	| "unknown_method"
	| "version_mismatch"
	| "not_implemented"
	| "handler_failed";

export type RpcError = Readonly<{ code: RpcErrorCode; message: string }>;

export type Response = Readonly<
	{
		v: typeof PROTOCOL_VERSION;
		/** The request's id; null when the request could not be read. */
		id: string | null;
		runtimeVersion: string;
	} & (
		| Readonly<{ ok: true; result: unknown }>
		| Readonly<{ ok: false; error: RpcError }>
	)
>;

/** A request that could not be decoded, with its id when one was readable. */
type DecodeError = RpcError & Readonly<{ id: string | null }>;

/** Largest message either side accepts, in bytes. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

export function createRequest(
	method: Method,
	params: unknown,
	clientVersion: string,
): Request {
	const base = {
		v: PROTOCOL_VERSION,
		id: crypto.randomUUID(),
		method,
		clientVersion,
	} as const;
	return params === undefined ? base : { ...base, params };
}

/** One message as a single line, newline included. */
export function encodeMessage(message: Request | Response): string {
	return `${JSON.stringify(message)}\n`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isMethod = (value: unknown): value is Method =>
	typeof value === "string" && (METHODS as readonly string[]).includes(value);

const parseJson = (line: string): unknown => {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
};

export function decodeRequest(line: string): Result<Request, DecodeError> {
	const fail = (code: RpcErrorCode, message: string, id: string | null) =>
		({ ok: false, error: { code, message, id } }) as const;
	const msg = parseJson(line);
	if (!isRecord(msg)) return fail("bad_request", "not a JSON object", null);
	const id = typeof msg.id === "string" ? msg.id : null;
	if (msg.v !== PROTOCOL_VERSION) {
		return fail(
			"version_mismatch",
			`protocol ${String(msg.v)} is not ${PROTOCOL_VERSION}`,
			id,
		);
	}
	if (id === null) return fail("bad_request", "missing request id", null);
	if (typeof msg.clientVersion !== "string") {
		return fail("bad_request", "missing clientVersion", id);
	}
	if (!isMethod(msg.method)) {
		return fail("unknown_method", `unknown method ${String(msg.method)}`, id);
	}
	const request: Request = {
		v: PROTOCOL_VERSION,
		id,
		method: msg.method,
		clientVersion: msg.clientVersion,
	};
	return {
		ok: true,
		value: "params" in msg ? { ...request, params: msg.params } : request,
	};
}

const RPC_ERROR_CODES: readonly RpcErrorCode[] = [
	"bad_request",
	"unknown_method",
	"version_mismatch",
	"not_implemented",
	"handler_failed",
];

const parseRpcError = (value: unknown): RpcError | null => {
	if (!isRecord(value)) return null;
	const { code, message } = value;
	if (!RPC_ERROR_CODES.includes(code as RpcErrorCode)) return null;
	return typeof message === "string"
		? { code: code as RpcErrorCode, message }
		: null;
};

export function decodeResponse(line: string): Result<Response, string> {
	const msg = parseJson(line);
	if (!isRecord(msg)) return { ok: false, error: "not a JSON object" };
	const { v, id, runtimeVersion } = msg;
	if (v !== PROTOCOL_VERSION) return { ok: false, error: "protocol mismatch" };
	if (typeof id !== "string" && id !== null) {
		return { ok: false, error: "missing id" };
	}
	if (typeof runtimeVersion !== "string") {
		return { ok: false, error: "missing runtimeVersion" };
	}
	const base = { v: PROTOCOL_VERSION, id, runtimeVersion } as const;
	if (msg.ok === true && "result" in msg) {
		return { ok: true, value: { ...base, ok: true, result: msg.result } };
	}
	const error = msg.ok === false ? parseRpcError(msg.error) : null;
	if (error === null) return { ok: false, error: "malformed response" };
	return { ok: true, value: { ...base, ok: false, error } };
}

/**
 * Splits a byte stream into lines. Returns an error once a line grows past
 * `maxBytes`, so a peer cannot make the other side buffer without bound.
 */
export function createLineSplitter(
	maxBytes: number,
): (chunk: Uint8Array) => Result<readonly string[], "too_long"> {
	const decoder = new TextDecoder();
	let buffered = "";
	return (chunk) => {
		buffered += decoder.decode(chunk, { stream: true });
		const parts = buffered.split("\n");
		buffered = parts.pop() ?? "";
		// A line that completes in this chunk can still be over the cap.
		const tooLong = [buffered, ...parts].some(
			(part) => Buffer.byteLength(part) > maxBytes,
		);
		if (tooLong) return { ok: false, error: "too_long" };
		return { ok: true, value: parts.filter((p) => p !== "") };
	};
}

/**
 * Writes to a socket without losing bytes the kernel did not take: the rest
 * is queued and flushed on `drain`.
 */
export type Writer = Readonly<{
	write: (socket: Socket<unknown>, text: string) => void;
	drain: (socket: Socket<unknown>) => void;
}>;

export function createWriter(): Writer {
	const encoder = new TextEncoder();
	let pending: Uint8Array = new Uint8Array(0);
	const flush = (socket: Socket<unknown>): void => {
		if (pending.length === 0) return;
		const written = socket.write(pending);
		pending = written > 0 ? pending.subarray(written) : pending;
		if (written < 0) pending = new Uint8Array(0);
	};
	return {
		write: (socket, text) => {
			const bytes = encoder.encode(text);
			if (pending.length === 0) {
				pending = bytes;
			} else {
				const joined = new Uint8Array(pending.length + bytes.length);
				joined.set(pending);
				joined.set(bytes, pending.length);
				pending = joined;
			}
			flush(socket);
		},
		drain: flush,
	};
}

type TransportError = Readonly<{
	kind: "connect_failed" | "timeout" | "closed" | "bad_response";
	message: string;
}>;

const errorMessage = (err: unknown): string =>
	err instanceof Error ? err.message : String(err);

/**
 * Sends one request on a fresh connection and resolves with the matching
 * response. Never rejects: connect failures, timeouts, early closes and
 * unreadable responses come back as a `TransportError`.
 */
export function sendRequest(
	address: string,
	request: Request,
	timeoutMs: number,
): Promise<Result<Response, TransportError>> {
	return new Promise((resolve) => {
		let settled = false;
		let socket: Socket<unknown> | null = null;
		const writer = createWriter();
		const split = createLineSplitter(MAX_MESSAGE_BYTES);

		const finish = (result: Result<Response, TransportError>): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket?.end();
			resolve(result);
		};
		const fail = (kind: TransportError["kind"], message: string): void =>
			finish({ ok: false, error: { kind, message } });

		const timer = setTimeout(
			() => fail("timeout", `no response within ${timeoutMs} ms`),
			Math.max(0, timeoutMs),
		);

		Bun.connect({
			unix: address,
			socket: {
				open: (s) => writer.write(s, encodeMessage(request)),
				drain: (s) => writer.drain(s),
				data: (_s, chunk) => {
					const lines = split(chunk);
					if (!lines.ok) return fail("bad_response", "response too large");
					const [line] = lines.value;
					if (line === undefined) return;
					const decoded = decodeResponse(line);
					if (!decoded.ok) return fail("bad_response", decoded.error);
					// Every request this client sends is readable, so a null id
					// (the reply to an unreadable request) is never its answer.
					if (decoded.value.id !== request.id) {
						return fail("bad_response", "response id does not match");
					}
					finish(decoded);
				},
				close: () => fail("closed", "runtime closed the connection"),
				error: (_s, err) => fail("closed", errorMessage(err)),
			},
		}).then(
			(s) => {
				socket = s;
				if (settled) s.end();
			},
			(err: unknown) => fail("connect_failed", errorMessage(err)),
		);
	});
}
