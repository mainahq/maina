/**
 * The Link client (#589, spec §6.3, FR-ID-6): authenticated calls to the
 * enrolled device's cloud.
 *
 * - Each call presents a short-lived device-bound token (`token.ts`) as
 *   `Authorization: Bearer`, reused while it has more than 30 s left.
 * - A 401 that says the token is stale or unknown (`token_expired`,
 *   `invalid_token`, `missing_token`) buys exactly one new token and retries
 *   the call once; a second 401 is the caller's error, never a loop.
 * - `device_revoked`, from the call or the token exchange, marks the device
 *   revoked in its state and stops Link: every later call, in this process
 *   or the next, fails `revoked` without touching the network, and
 *   `maina cloud status` shows it until the device enrols again.
 *
 * Later tasks (uplink, policy pull, approvals) send through `send`.
 */

import type { Result } from "@mainahq/core";
import {
	checkBaseUrl,
	isSuccess,
	type LinkAnswer,
	type LinkFailure,
	linkCall,
	refusal,
} from "./http";
import { LINK_CODES } from "./protocol/wire";
import {
	type AccessToken,
	type LinkPorts,
	linkToken,
	revokedFailure,
} from "./token";

type LinkRequest = Readonly<{
	method: "GET" | "POST";
	/** An endpoint path from the enrolment, e.g. `/link/v1/events`. */
	path: string;
	/**
	 * A message the caller has already built and checked with `parseWire`
	 * (the uplink, policy and approval tasks add their kinds there). A body
	 * that cannot be serialised is refused as `invalid_body`, never thrown.
	 */
	body?: unknown;
	/**
	 * Extra request headers, such as the policy pull's `If-None-Match`. The
	 * client's own `Authorization` always wins over one set here.
	 */
	headers?: Readonly<Record<string, string>>;
	/**
	 * Query parameters, such as the approvals long poll's `waitMs`. Names
	 * and values are plain words (`[A-Za-z0-9_]`); anything else is refused
	 * as `invalid_path`, like a path that could leave the enrolled cloud.
	 */
	query?: Readonly<Record<string, string>>;
	/** How long the HTTP call may take; the Link default when absent. */
	timeoutMs?: number;
}>;

type LinkResponse = Readonly<{ status: number; data: unknown }>;

type LinkClient = Readonly<{
	send: (request: LinkRequest) => Promise<Result<LinkResponse, LinkFailure>>;
}>;

/** A token this close to expiry is renewed before use. */
const RENEW_MARGIN_MS = 30_000;

/**
 * A Link endpoint path: `/link/v<n>` then plain segments. Anything else
 * (no leading slash, `//host`, `@host`, `..`, a query or a full URL) could
 * send the bearer token somewhere other than the enrolled cloud, so it is
 * refused before a token is bought or attached.
 */
const LINK_PATH = /^\/link\/v[0-9]+(\/[A-Za-z0-9][A-Za-z0-9_.:-]*)+$/;

/** A query name or value: a plain word, never an encoded `&`, `#` or `/`. */
const QUERY_WORD = /^[A-Za-z0-9_]{1,64}$/;

/** `?a=b&...` for `query`, `""` for none, or null when a part is not a word. */
function queryString(
	query: Readonly<Record<string, string>> | undefined,
): string | null {
	const entries = Object.entries(query ?? {});
	if (entries.some(([k, v]) => !QUERY_WORD.test(k) || !QUERY_WORD.test(v))) {
		return null;
	}
	return entries.length === 0
		? ""
		: `?${entries.map(([k, v]) => `${k}=${v}`).join("&")}`;
}

const STALE_TOKEN: ReadonlySet<string> = new Set([
	LINK_CODES.token_expired,
	LINK_CODES.invalid_token,
	LINK_CODES.missing_token,
]);

export function createLinkClient(ports: LinkPorts): LinkClient {
	let token: AccessToken | null = null;
	let stopped: LinkFailure | null = null;

	async function currentToken(
		renew: boolean,
	): Promise<Result<AccessToken, LinkFailure>> {
		const now = ports.clock().getTime();
		if (!renew && token !== null && token.expiresAt - RENEW_MARGIN_MS > now) {
			return { ok: true, value: token };
		}
		token = null;
		const fresh = await linkToken(ports);
		if (fresh.ok) token = fresh.value;
		return fresh;
	}

	function stop<T>(failure: Result<T, LinkFailure>): Result<T, LinkFailure> {
		if (!failure.ok && failure.error.kind === "revoked") {
			stopped = failure.error;
			token = null;
		}
		return failure;
	}

	async function call(
		base: string,
		request: LinkRequest,
		renew: boolean,
	): Promise<Result<LinkAnswer, LinkFailure>> {
		const t = await currentToken(renew);
		if (!t.ok) return t;
		return linkCall(
			ports.http,
			request.method,
			`${base}${request.path}${queryString(request.query) ?? ""}`,
			request.body,
			{
				...Object.fromEntries(
					Object.entries(request.headers ?? {}).filter(
						([name]) => name.toLowerCase() !== "authorization",
					),
				),
				Authorization: `Bearer ${t.value.token}`,
			},
			request.timeoutMs,
		);
	}

	return {
		send: async (request) => {
			if (stopped !== null) return { ok: false, error: stopped };
			if (
				!LINK_PATH.test(request.path) ||
				queryString(request.query) === null
			) {
				return {
					ok: false,
					error: { kind: "invalid_path", path: request.path },
				};
			}
			const read = ports.store.readState();
			if (!read.ok) return read;
			if (read.value === null) {
				return { ok: false, error: { kind: "not_enrolled" } };
			}
			if (read.value.revokedAt !== null) {
				return stop({
					ok: false,
					error: { kind: "revoked", revokedAt: read.value.revokedAt },
				});
			}
			const base = checkBaseUrl(read.value.baseUrl);
			if (!base.ok) return base;

			let answer = await call(base.value, request, false);
			if (
				answer.ok &&
				answer.value.status === 401 &&
				STALE_TOKEN.has(answer.value.envelope.error ?? "")
			) {
				answer = await call(base.value, request, true);
			}
			if (!answer.ok) return stop(answer);
			if (answer.value.envelope.error === LINK_CODES.device_revoked) {
				return stop(revokedFailure(ports.store, ports.clock()));
			}
			if (!isSuccess(answer.value)) {
				return { ok: false, error: refusal(answer.value) };
			}
			return {
				ok: true,
				value: {
					status: answer.value.status,
					data: answer.value.envelope.data,
				},
			};
		},
	};
}
