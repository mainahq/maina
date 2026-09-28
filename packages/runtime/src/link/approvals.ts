/**
 * Remote approvals in the hook path (#593, cloud plan Task 7.3, FR-APR-1,
 * FR-APR-4, FR-APR-7, spec §6.1 rule 1, cloud adr/0014).
 *
 * When the managed policy routes a gate `ask` to the org's approvers, the
 * runtime sends the org's approvals channel a signed `ApprovalAsk`
 * (`POST /link/v1/approvals`) and long-polls it (`GET
 * /link/v1/approvals/<askId>/wait`) for an `ApprovalResolution`. The verdict
 * is still computed and enforced here (spec §6.1 rule 1): the cloud only
 * says who approved.
 *
 * - **Signed resolutions.** A resolution counts only when it names this
 *   device, its org and the ask, and verifies under a pinned
 *   approval-resolution key valid now. Anything else (a bad signature, an
 *   unknown key, a malformed answer) is a `deny`.
 * - **Unsigned resolutions.** While the cloud's signer is dark it marks
 *   resolutions unsigned (`keyId: "unsigned"`, an all-zero `sig`). No
 *   pinned key verifies them, so, as the runtime refuses an unsigned policy
 *   bundle, they may tighten but never loosen: an unsigned denial denies,
 *   and an unsigned approval of any class falls back to the local ask.
 * - **Fail closed.** No path here allows without an approval: an
 *   unreachable or refusing cloud, an unenrolled or revoked device and an
 *   unreadable state all resolve to the route's `onTimeout` (`deny` or
 *   `ask-local`), and a timeout to the stricter of the route's and the
 *   cloud's fallback.
 * - **Hook budgets.** A host kills a hook that outlives its timeout, and
 *   Claude Code and Codex then run the tool (they fail open), so the wait
 *   never comes near it. `timeoutMs` is what the hook can spare (the gate
 *   passes `GateApprovals.waitMs`). A route whose timeout is longer is
 *   clamped to it: the ask stays open in the cloud and the host gets its
 *   local ask with a line linking to the ask (`waiting`). The same action
 *   retried later names the same open ask (by `RemoteAsk.key`), so once an
 *   approver has resolved it the retry gets the resolution without a new
 *   ask. On an irreversible class whose route denies on timeout the clamp
 *   is a deny with that link instead: a local prompt never stands in for
 *   the approver there. A resolution is used once.
 * - **Events.** `approval.requested` is enqueued for the uplink when an
 *   ask is taken and `approval.resolved` when an approval or denial is
 *   applied, metadata only. The cloud records timeouts itself.
 */

import type { GateApprovalNote, Result } from "@mainahq/core";
import { createLinkClient } from "./client";
import { checkBaseUrl } from "./http";
import { approvalResolutionSigningInput, deviceSigningInput } from "./keys";
import { type EventSink, label } from "./producers/emit";
import {
	type ApprovalFallback,
	type ApprovalResolution,
	parseWire,
} from "./protocol/wire";
import type { DeviceState } from "./store";
import type { LinkPorts } from "./token";
import { trustedOrgKeys } from "./trust";

/**
 * Where an `ask` goes (from the managed policy): to the developer's local
 * prompt (the default, FR-APR-1) or to the org's remote approvers, how long
 * they get, and what a timeout resolves to (FR-APR-4).
 */
export type ApprovalRoute = Readonly<{
	target: "local" | "remote";
	timeoutMs: number;
	onTimeout: ApprovalFallback;
}>;

/** The route of every ask while the managed policy names none. */
export const LOCAL_ROUTE: ApprovalRoute = {
	target: "local",
	timeoutMs: 10 * 60_000,
	onTimeout: "ask-local",
};

/** One ask, as the gate hands it over. */
export type RemoteAsk = Readonly<{
	/**
	 * What the ask is about (root, session and action), so a retry of the
	 * same action finds the ask still open. Never sent.
	 */
	key: string;
	/** The action class behind the ask, a Maina label. */
	actionClass: string;
	/** Whether the policy holds that class irreversible. */
	irreversible: boolean;
	/** The managed policy's `sha256:` etag. */
	policyHash: string;
}>;

type RemoteOutcome = "allow" | "deny" | "ask-local";

export type RemoteApproval = Readonly<{
	outcome: RemoteOutcome;
	/** What the host's message says about it; absent for a local route. */
	note?: GateApprovalNote;
}>;

type ApprovalsPorts = LinkPorts &
	Readonly<{
		/** The uplink's `enqueue`; events are dropped without one. */
		sink?: EventSink;
		/** Monotonic milliseconds for the wait's deadline. */
		now?: () => number;
		sleep?: (ms: number) => Promise<void>;
		newAskId?: () => string;
	}>;

type AwaitOptions = Readonly<{
	/** What the host's hook can spare for the wait, below its own timeout. */
	timeoutMs: number;
}>;

/** The cloud holds a long poll at most this long (adr/0014). */
const MAX_POLL_MS = 25_000;
/** A long poll asks the cloud to answer this much before the deadline. */
const POLL_MARGIN_MS = 200;
/** The pause between long polls that answered `pending` early. */
const POLL_GAP_MS = 250;
/** How far past the deadline a stuck port is cut off. */
const GRACE_MS = 250;
/** Open asks remembered for a retry; the oldest go first past this. */
const MAX_OPEN = 256;

/** How the dark signer marks a resolution (cloud adr/0014 §6). */
const DARK_KEY_ID = "unsigned";
const DARK_SIG = "A".repeat(86);

/** The schema's id pattern (`ID`), for the ask's inbox id. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;

/** An ask taken by the cloud and not yet resolved. */
type OpenAsk = Readonly<{
	askId: string;
	/** Wall-clock epoch ms. */
	sentAt: number;
	expiresAt: number;
	link?: string;
}>;

/** One `awaitRemoteApproval` call, as its steps need it. */
type Waiting = Readonly<{
	ask: RemoteAsk;
	route: ApprovalRoute;
	state: DeviceState;
	/** The wait was cut to the hook's limit, short of the route's timeout. */
	clamped: boolean;
	deadline: number;
	/**
	 * Set once the host got its answer at the deadline: a port still running
	 * past it may remember the ask but never applies (and so never uses up)
	 * a resolution the host did not see.
	 */
	cut: { done: boolean };
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The stricter of two fallbacks: `deny` wins. */
const stricter = (
	a: ApprovalFallback,
	b: ApprovalFallback,
): ApprovalFallback => (a === "deny" || b === "deny" ? "deny" : "ask-local");

/** What a clamped wait falls back to; see the module doc. */
const clampFallback = (ask: RemoteAsk, route: ApprovalRoute): RemoteOutcome =>
	ask.irreversible && route.onTimeout === "deny" ? "deny" : "ask-local";

/**
 * The ask in the org's approvals inbox: the app host's `/approvals/<id>`,
 * where the cloud's API host `api.<domain>` serves the app as
 * `app.<domain>`. Undefined when the id or the base URL is unusable.
 */
function inboxLink(baseUrl: string, requestId: unknown): string | undefined {
	if (typeof requestId !== "string" || !ID.test(requestId)) return undefined;
	const base = checkBaseUrl(baseUrl);
	if (!base.ok) return undefined;
	const url = new URL(base.value);
	const host = url.host.startsWith("api.")
		? `app.${url.host.slice(4)}`
		: url.host;
	return `${url.protocol}//${host}/approvals/${encodeURIComponent(requestId)}`;
}

/** Who resolved it, as the host's message names them. */
const resolver = (r: ApprovalResolution): string | undefined =>
	r.resolvedBy === undefined
		? undefined
		: `${r.resolvedBy.kind} ${r.resolvedBy.id}`;

function note(
	status: GateApprovalNote["status"],
	extra: Readonly<{ link?: string; by?: string }> = {},
): GateApprovalNote {
	return {
		status,
		...(extra.link === undefined ? {} : { link: extra.link }),
		...(extra.by === undefined ? {} : { by: extra.by }),
	};
}

/** `p`, or `late()` once `ms` have passed without it settling. */
async function withDeadline<T>(
	p: Promise<T>,
	ms: number,
	late: () => T,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const cut = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(late()), Math.max(0, ms));
	});
	try {
		return await Promise.race([p, cut]);
	} finally {
		clearTimeout(timer);
	}
}

export function createRemoteApprovals(ports: ApprovalsPorts): Readonly<{
	awaitRemoteApproval: (
		ask: RemoteAsk,
		route: ApprovalRoute,
		options: AwaitOptions,
	) => Promise<RemoteApproval>;
}> {
	const client = createLinkClient(ports);
	const now = ports.now ?? (() => performance.now());
	const sleep =
		ports.sleep ??
		((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const newAskId =
		ports.newAskId ?? (() => `ask_${ports.crypto.randomToken(16)}`);
	const open = new Map<string, OpenAsk>();

	const wall = (): number => ports.clock().getTime();

	function forget(key: string): void {
		open.delete(key);
	}

	/** Drops expired asks, then the oldest past `MAX_OPEN`. */
	function prune(): void {
		const t = wall();
		for (const [key, entry] of open) {
			if (entry.expiresAt <= t) open.delete(key);
		}
		for (const key of open.keys()) {
			if (open.size < MAX_OPEN) break;
			open.delete(key);
		}
	}

	function enqueue(
		type: "approval.requested" | "approval.resolved",
		data: Readonly<Record<string, unknown>>,
	): void {
		try {
			ports.sink?.enqueue({ type, data });
		} catch {
			// The uplink is evidence, not the gate: a lost event blocks nothing.
		}
	}

	/** The route's answer when the channel failed: never an allow. */
	const unavailable = (
		route: ApprovalRoute,
		link?: string,
	): RemoteApproval => ({
		outcome: route.onTimeout,
		note: note("unavailable", link === undefined ? {} : { link }),
	});

	/** The deadline passed with the ask unresolved. */
	function expired(w: Waiting, entry: OpenAsk | undefined): RemoteApproval {
		const link = entry?.link;
		if (w.clamped) {
			return {
				outcome: clampFallback(w.ask, w.route),
				note: note("waiting", link === undefined ? {} : { link }),
			};
		}
		forget(w.ask.key);
		return {
			outcome: w.route.onTimeout,
			note: note("timeout", link === undefined ? {} : { link }),
		};
	}

	/** Whether `r` verifies under a pinned approval-resolution key. */
	function verified(state: DeviceState, r: ApprovalResolution): boolean {
		const key = trustedOrgKeys(
			state,
			ports.clock(),
			"approval-resolution",
		).find((k) => k.keyId === r.keyId);
		if (key === undefined) return false;
		const input = approvalResolutionSigningInput(r.orgId, r);
		return input.ok && ports.crypto.verify(key.publicKey, input.value, r.sig);
	}

	/** Applies a resolution the cloud sent for `entry`. */
	function settle(w: Waiting, entry: OpenAsk, raw: unknown): RemoteApproval {
		const link = entry.link === undefined ? {} : { link: entry.link };
		const untrusted: RemoteApproval = {
			outcome: "deny",
			note: note("untrusted", link),
		};
		const parsed = parseWire("approval-resolution", raw);
		if (!parsed.ok) return untrusted;
		const r = parsed.value;
		const { deviceId, orgId } = w.state.enrolment;
		if (
			r.askId !== entry.askId ||
			r.deviceId !== deviceId ||
			r.orgId !== orgId
		) {
			return untrusted;
		}
		const dark = r.keyId === DARK_KEY_ID && r.sig === DARK_SIG;
		if (!dark && !verified(w.state, r)) return untrusted;
		// The host already has its answer: leave the resolution for a retry.
		if (w.cut.done) return expired(w, entry);
		forget(w.ask.key);
		const by = resolver(r);
		const named = { ...link, ...(by === undefined ? {} : { by }) };
		const latencyMs = Math.max(0, Math.round(wall() - entry.sentAt));
		switch (r.resolution) {
			case "approved":
				// Unverified, it may not loosen anything: the local prompt stands in.
				if (dark)
					return { outcome: "ask-local", note: note("untrusted", named) };
				enqueue("approval.resolved", { resolution: "approved", latencyMs });
				return { outcome: "allow", note: note("approved", named) };
			case "denied":
				enqueue("approval.resolved", { resolution: "denied", latencyMs });
				return { outcome: "deny", note: note("denied", named) };
			case "timeout":
				return {
					outcome: stricter(r.fallback ?? "deny", w.route.onTimeout),
					note: note("timeout", link),
				};
			default: {
				const unknown: never = r.resolution;
				return unknown;
			}
		}
	}

	/** Takes a new ask for `w`; the open entry, or the outcome that ended it. */
	async function create(w: Waiting): Promise<Result<OpenAsk, RemoteApproval>> {
		const { ask, route, state } = w;
		const sentAt = wall();
		const expiresAt = sentAt + route.timeoutMs;
		const unsigned = {
			v: 1,
			askId: newAskId(),
			deviceId: state.enrolment.deviceId,
			sentAt: new Date(sentAt).toISOString(),
			fallback: route.onTimeout,
			dataClass: "metadata",
			data: {
				actionClass: label(ask.actionClass),
				policyHash: ask.policyHash,
				expiresAt: new Date(expiresAt).toISOString(),
			},
		} as const;
		const key = ports.store.readPrivateKey();
		if (!key.ok || key.value === null) {
			return { ok: false, error: unavailable(route) };
		}
		const input = deviceSigningInput("approval-ask", unsigned, "sig");
		if (!input.ok) return { ok: false, error: unavailable(route) };
		const sig = ports.crypto.sign(key.value, input.value);
		if (!sig.ok) return { ok: false, error: unavailable(route) };
		const body = parseWire("approval-ask", { ...unsigned, sig: sig.value });
		if (!body.ok) return { ok: false, error: unavailable(route) };
		const sent = await client.send({
			method: "POST",
			path: state.enrolment.endpoints.approvals,
			body: body.value,
			timeoutMs: Math.max(1, Math.ceil(w.deadline - now())),
		});
		if (!sent.ok || !isRecord(sent.value.data)) {
			return { ok: false, error: unavailable(route) };
		}
		const reply = sent.value.data;
		const link = inboxLink(state.baseUrl, reply.requestId);
		const entry: OpenAsk = {
			askId: unsigned.askId,
			sentAt,
			expiresAt,
			...(link === undefined ? {} : { link }),
		};
		prune();
		open.set(ask.key, entry);
		enqueue("approval.requested", unsigned.data);
		if (reply.resolution !== undefined) {
			return { ok: false, error: settle(w, entry, reply.resolution) };
		}
		return { ok: true, value: entry };
	}

	/** Long-polls `entry` until it resolves or the deadline passes. */
	async function poll(w: Waiting, entry: OpenAsk): Promise<RemoteApproval> {
		const path = `${w.state.enrolment.endpoints.approvals}/${entry.askId}/wait`;
		for (;;) {
			const left = w.deadline - now();
			if (left <= 0) return expired(w, entry);
			const waitMs = Math.min(
				MAX_POLL_MS,
				Math.max(0, Math.floor(left - POLL_MARGIN_MS)),
			);
			const polled = await client.send({
				method: "GET",
				path,
				query: { waitMs: String(waitMs) },
				timeoutMs: Math.max(1, Math.ceil(left)),
			});
			if (!polled.ok) {
				// A poll cut off by the deadline is the deadline, not an outage.
				if (w.deadline - now() <= 0) return expired(w, entry);
				if (polled.error.kind === "refused" && polled.error.status === 404) {
					forget(w.ask.key);
				}
				return unavailable(w.route, entry.link);
			}
			const data = polled.value.data;
			if (isRecord(data) && data.status === "resolved") {
				return settle(w, entry, data.resolution);
			}
			if (!isRecord(data) || data.status !== "pending") {
				return unavailable(w.route, entry.link);
			}
			const rest = w.deadline - now();
			if (rest > 0) await sleep(Math.min(POLL_GAP_MS, rest));
		}
	}

	async function run(w: Waiting, known: OpenAsk | undefined) {
		if (known !== undefined) return poll(w, known);
		const created = await create(w);
		return created.ok ? poll(w, created.value) : created.error;
	}

	return {
		awaitRemoteApproval: async (ask, route, { timeoutMs }) => {
			if (route.target !== "remote") return { outcome: "ask-local" };
			try {
				const read = ports.store.readState();
				if (!read.ok || read.value === null || read.value.revokedAt !== null) {
					return unavailable(route);
				}
				prune();
				const known = open.get(ask.key);
				const orgLeft =
					known === undefined ? route.timeoutMs : known.expiresAt - wall();
				const hookLeft = Math.max(0, timeoutMs);
				const clamped = orgLeft > hookLeft;
				const budget = Math.max(0, Math.min(orgLeft, hookLeft));
				const w: Waiting = {
					ask,
					route,
					state: read.value,
					clamped,
					deadline: now() + budget,
					cut: { done: false },
				};
				return await withDeadline(run(w, known), budget + GRACE_MS, () => {
					w.cut.done = true;
					return expired(w, open.get(ask.key));
				});
			} catch {
				return unavailable(route);
			}
		},
	};
}
