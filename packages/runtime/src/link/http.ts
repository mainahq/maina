/**
 * One Link HTTP exchange (#589): JSON in, the `{ data, error, meta }`
 * envelope out, every failure a value. The HTTP port is core's (the CLI's
 * `fetchHttp` in production), so the same code runs under Node and Bun.
 */

import type { HttpPort, Result } from "@mainahq/core";
import type { CryptoFailure } from "./keys";
import type { ApiEnvelope, WireRefusal } from "./protocol/wire";
import type { StoreError } from "./store";

/** Why a Link operation did not go through. */
export type LinkFailure =
	| Readonly<{ kind: "not_enrolled" }>
	| Readonly<{ kind: "revoked"; revokedAt: string }>
	| Readonly<{ kind: "insecure_url"; url: string }>
	| Readonly<{ kind: "network"; message: string }>
	| Readonly<{
			kind: "refused";
			status: number;
			code: string;
			message: string;
	  }>
	| Readonly<{ kind: "invalid_response"; message: string }>
	| WireRefusal
	| CryptoFailure
	| StoreError;

export type LinkAnswer = Readonly<{ status: number; envelope: ApiEnvelope }>;

const TIMEOUT_MS = 15_000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The cloud base URL without a trailing slash. HTTPS only, except to this
 * machine: a device proof or token never crosses the network in clear.
 */
export function checkBaseUrl(
	raw: string,
): Result<string, Readonly<{ kind: "insecure_url"; url: string }>> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { ok: false, error: { kind: "insecure_url", url: raw } };
	}
	const secure =
		url.protocol === "https:" ||
		(url.protocol === "http:" && LOOPBACK.has(url.hostname));
	if (!secure || url.username !== "" || url.password !== "") {
		return { ok: false, error: { kind: "insecure_url", url: raw } };
	}
	return {
		ok: true,
		value: `${url.origin}${url.pathname}`.replace(/\/+$/, ""),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEnvelope(body: string): ApiEnvelope | null {
	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch {
		return null;
	}
	if (!isRecord(value) || !("data" in value)) return null;
	if (value.error !== null && typeof value.error !== "string") return null;
	return value as ApiEnvelope;
}

/** One call; any HTTP status is an answer, only transport failures fail. */
export async function linkCall(
	http: HttpPort,
	method: "GET" | "POST",
	url: string,
	body: unknown,
	headers: Readonly<Record<string, string>> = {},
): Promise<Result<LinkAnswer, LinkFailure>> {
	const sent = await http.request({
		method,
		url,
		headers: {
			Accept: "application/json",
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
			...headers,
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		timeoutMs: TIMEOUT_MS,
	});
	if (!sent.ok) {
		const e = sent.error;
		const message =
			e.kind === "network"
				? e.message
				: e.kind === "timeout"
					? `no answer from ${e.url} in ${TIMEOUT_MS / 1000}s`
					: `HTTP ${e.status} from ${e.url}`;
		return { ok: false, error: { kind: "network", message } };
	}
	const envelope = parseEnvelope(sent.value.body);
	if (envelope === null) {
		return {
			ok: false,
			error: {
				kind: "invalid_response",
				message: `HTTP ${sent.value.status} without a Link envelope from ${url}`,
			},
		};
	}
	return { ok: true, value: { status: sent.value.status, envelope } };
}

export function isSuccess(answer: LinkAnswer): boolean {
	return (
		answer.status >= 200 &&
		answer.status < 300 &&
		answer.envelope.error === null
	);
}

/** The refusal an answer carries, by its machine code. */
export function refusal(answer: LinkAnswer): LinkFailure {
	const meta = answer.envelope.meta;
	return {
		kind: "refused",
		status: answer.status,
		code: answer.envelope.error ?? `http_${answer.status}`,
		message: typeof meta?.message === "string" ? meta.message : "",
	};
}
