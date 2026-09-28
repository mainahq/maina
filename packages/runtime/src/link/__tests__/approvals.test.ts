/**
 * Remote approvals (#593, cloud plan Task 7.3, FR-APR-1/4/7, spec §6.1
 * rule 1): a gate `ask` the managed policy routes to remote approvers is
 * sent to the org's approvals channel as a signed `ApprovalAsk`, and the
 * runtime waits (inside the hook's budget) for a resolution signed by the
 * org's pinned approval-resolution key. Every failure resolves to `deny` or
 * `ask-local` per the route, never to an allow.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { testTmpDir } from "../../__tests__/test-tmp";
import {
	type ApprovalRoute,
	createRemoteApprovals,
	type RemoteAsk,
} from "../approvals";
import { enrolDevice } from "../enrol";
import { nodeLinkCrypto } from "../keys";
import type { EventInput } from "../outbox";
import { parseWire } from "../protocol/wire";
import { fileLinkStore, type LinkStore } from "../store";
import { type FakeCloud, fakeCloud } from "./fake-cloud";

let dir: string;
/** Each setup enrols its own device, in its own Link directory. */
let setups = 0;

beforeEach(() => {
	dir = testTmpDir("maina-link-approvals-");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-09-28T09:15:03.000Z");
const POLICY_HASH = `sha256:${"b".repeat(64)}`;

const ask = (overrides: Partial<RemoteAsk> = {}): RemoteAsk => ({
	key: "push origin main",
	actionClass: "git.push.protected",
	irreversible: false,
	policyHash: POLICY_HASH,
	...overrides,
});

/** Ten minutes, the cloud's default route timeout: past any hook's limit. */
const LONG: ApprovalRoute = {
	target: "remote",
	timeoutMs: 10 * 60_000,
	onTimeout: "deny",
};

/** A route whose timeout fits inside the hook's limit. */
const SHORT = (onTimeout: ApprovalRoute["onTimeout"]): ApprovalRoute => ({
	target: "remote",
	timeoutMs: 40,
	onTimeout,
});

const HOOK = { timeoutMs: 2_000 };

type Setup = Readonly<{
	cloud: FakeCloud;
	/** From now on the device state cannot be read. */
	breakStore: () => void;
	events: EventInput[];
	approvals: ReturnType<typeof createRemoteApprovals>;
}>;

async function setup(
	options: Readonly<{
		enrol?: boolean;
		onAsk?: (cloud: FakeCloud) => void;
		/** Wraps the fake cloud's HTTP port, e.g. to stall a request. */
		wrapHttp?: (cloud: FakeCloud) => FakeCloud["http"];
	}> = {},
): Promise<Setup> {
	const cloud = fakeCloud();
	const http = options.wrapHttp?.(cloud) ?? cloud.http;
	const files = fileLinkStore(join(dir, `link-${++setups}`));
	let broken = false;
	const store: LinkStore = {
		...files,
		readState: () =>
			broken
				? { ok: false, error: { kind: "store", op: "read", message: "EIO" } }
				: files.readState(),
	};
	const ports = {
		http,
		store,
		crypto: nodeLinkCrypto,
		clock: () => new Date(NOW),
	};
	if (options.enrol !== false) {
		const done = await enrolDevice(
			{ ...ports, sleep: async () => {} },
			{
				baseUrl: cloud.baseUrl,
				device: { os: "linux", arch: "x64", runtimeVersion: "1.8.1" },
			},
		);
		if (!done.ok) throw new Error(JSON.stringify(done.error));
	}
	const events: EventInput[] = [];
	let n = 0;
	const approvals = createRemoteApprovals({
		...ports,
		sink: {
			enqueue: (input) => {
				events.push(input);
				return { ok: true, value: { queued: true, eventId: "e", seq: 1 } };
			},
		},
		newAskId: () => `ask_${++n}`,
		// A resolution set by the test lands between the ask and its wait.
		sleep: async (ms) => {
			options.onAsk?.(cloud);
			await new Promise((r) => setTimeout(r, Math.min(ms, 5)));
		},
	});
	return {
		cloud,
		breakStore: () => {
			broken = true;
		},
		events,
		approvals,
	};
}

/** Resolves the first ask as soon as it is taken. */
const resolveFirst =
	(
		resolution: Parameters<FakeCloud["resolveApproval"]>[1],
		opts?: Parameters<FakeCloud["resolveApproval"]>[2],
	) =>
	(cloud: FakeCloud) => {
		const stored = cloud.state.asks.get("ask_1");
		if (stored !== undefined && stored.resolution === null) {
			cloud.resolveApproval("ask_1", resolution, opts);
		}
	};

describe("awaitRemoteApproval", () => {
	test("approved: the host receives allow", async () => {
		const { cloud, approvals } = await setup({
			onAsk: resolveFirst("approved"),
		});
		const got = await approvals.awaitRemoteApproval(ask(), LONG, HOOK);
		expect(got.outcome).toBe("allow");
		expect(got.note).toMatchObject({
			status: "approved",
			by: "member mem_7c1d",
		});
		// The ask went out signed by the device, at the metadata class.
		const sent = cloud.state.asks.get("ask_1");
		expect(sent?.ask).toMatchObject({
			v: 1,
			askId: "ask_1",
			fallback: "deny",
			dataClass: "metadata",
			data: { actionClass: "git.push.protected", policyHash: POLICY_HASH },
		});
	});

	test("denied: deny, with the approver's name", async () => {
		const { approvals } = await setup({
			onAsk: resolveFirst("denied", {
				resolvedBy: { kind: "member", id: "mem_alice" },
			}),
		});
		const got = await approvals.awaitRemoteApproval(ask(), LONG, HOOK);
		expect(got.outcome).toBe("deny");
		expect(got.note).toMatchObject({
			status: "denied",
			by: "member mem_alice",
		});
	});

	test("the waiting note links to the ask in the org's inbox", async () => {
		const { approvals } = await setup();
		const got = await approvals.awaitRemoteApproval(ask(), LONG, {
			timeoutMs: 30,
		});
		expect(got.note?.status).toBe("waiting");
		expect(got.note?.link).toBe("https://cloud.test/approvals/apr_1");
	});

	test("timeout: deny or ask-local per the route", async () => {
		const deny = await setup();
		const denied = await deny.approvals.awaitRemoteApproval(
			ask(),
			SHORT("deny"),
			HOOK,
		);
		expect(denied).toMatchObject({
			outcome: "deny",
			note: { status: "timeout" },
		});

		const local = await setup();
		const asked = await local.approvals.awaitRemoteApproval(
			ask(),
			SHORT("ask-local"),
			HOOK,
		);
		expect(asked).toMatchObject({
			outcome: "ask-local",
			note: { status: "timeout" },
		});
	});

	test("the cloud's timeout resolution applies the stricter fallback", async () => {
		const { approvals } = await setup({
			onAsk: resolveFirst("timeout", { fallback: "deny" }),
		});
		const got = await approvals.awaitRemoteApproval(
			ask(),
			{ ...LONG, onTimeout: "ask-local" },
			HOOK,
		);
		expect(got).toMatchObject({ outcome: "deny", note: { status: "timeout" } });
	});

	test("a bad signature: deny", async () => {
		const tampered = await setup({
			onAsk: resolveFirst("denied", { tamper: true }),
		});
		const forged = await tampered.approvals.awaitRemoteApproval(
			ask(),
			{ ...LONG, onTimeout: "ask-local" },
			HOOK,
		);
		expect(forged).toMatchObject({
			outcome: "deny",
			note: { status: "untrusted" },
		});

		// A key the device never pinned (another purpose's) is no better.
		const wrongKey = await setup({
			onAsk: resolveFirst("approved", { keyId: "key_policy_1" }),
		});
		const got = await wrongKey.approvals.awaitRemoteApproval(ask(), LONG, HOOK);
		expect(got).toMatchObject({
			outcome: "deny",
			note: { status: "untrusted" },
		});
	});

	test("an unsigned approval (signer dark) never allows: the local prompt stands in", async () => {
		// No pinned key verifies it, like an unsigned policy bundle: whatever
		// the class, it falls back to the prompt the developer had anyway.
		for (const irreversible of [false, true]) {
			const s = await setup({
				onAsk: resolveFirst("approved", { signed: false }),
			});
			const got = await s.approvals.awaitRemoteApproval(
				ask(
					irreversible
						? { actionClass: "fs.delete.recursive", irreversible: true }
						: {},
				),
				LONG,
				HOOK,
			);
			expect(got).toMatchObject({
				outcome: "ask-local",
				note: { status: "untrusted" },
			});
			// Not applied, so not reported as resolved.
			expect(s.events.map((e) => e.type)).toEqual(["approval.requested"]);
		}

		// An unsigned denial still denies: tightening needs no signature.
		const denial = await setup({
			onAsk: resolveFirst("denied", { signed: false }),
		});
		expect(
			(await denial.approvals.awaitRemoteApproval(ask(), LONG, HOOK)).outcome,
		).toBe("deny");
	});

	test("a resolution landing after the hook's deadline stays for the retry", async () => {
		// A port that ignores its timeout: the approver resolves the ask, but
		// the wait brings the answer long after the hook's cut.
		let stall = true;
		const { cloud, approvals, events } = await setup({
			wrapHttp: (fake) => ({
				request: async (req) => {
					if (stall && req.url.includes("/wait")) {
						resolveFirst("approved")(fake);
						const res = await fake.http.request(req);
						await new Promise((r) => setTimeout(r, 400));
						return res;
					}
					return fake.http.request(req);
				},
			}),
		});
		const got = await approvals.awaitRemoteApproval(ask(), LONG, {
			timeoutMs: 20,
		});
		expect(got).toMatchObject({
			outcome: "ask-local",
			note: { status: "waiting" },
		});
		// The stalled wait answers in the background; it must not use up the
		// approval the host never saw.
		await new Promise((r) => setTimeout(r, 500));
		expect(events.map((e) => e.type)).toEqual(["approval.requested"]);
		stall = false;
		const retried = await approvals.awaitRemoteApproval(ask(), LONG, HOOK);
		expect(retried.outcome).toBe("allow");
		expect(cloud.state.askCalls).toBe(1);
	});

	test("a route timeout past the hook's limit is clamped and falls back to ask-local", async () => {
		const { cloud, approvals } = await setup();
		const started = performance.now();
		const got = await approvals.awaitRemoteApproval(ask(), LONG, {
			timeoutMs: 60,
		});
		expect(performance.now() - started).toBeLessThan(1_000);
		expect(got).toMatchObject({
			outcome: "ask-local",
			note: { status: "waiting" },
		});
		// Each long poll asked for no more than the hook had left.
		for (const w of cloud.state.waits)
			expect(Number(w)).toBeLessThanOrEqual(60);

		// The ask stays open in the cloud: once approved, the retry of the same
		// action gets the approval without asking again.
		cloud.resolveApproval("ask_1", "approved");
		const retried = await approvals.awaitRemoteApproval(ask(), LONG, HOOK);
		expect(retried.outcome).toBe("allow");
		expect(cloud.state.askCalls).toBe(1);

		// A resolution is used once: the next identical action asks anew.
		await approvals.awaitRemoteApproval(ask(), LONG, { timeoutMs: 20 });
		expect(cloud.state.askCalls).toBe(2);
	});

	test("a clamped wait on an irreversible class the route denies on timeout is a deny, never a local prompt", async () => {
		const { approvals } = await setup();
		const got = await approvals.awaitRemoteApproval(
			ask({ actionClass: "fs.delete.recursive", irreversible: true }),
			LONG,
			{ timeoutMs: 30 },
		);
		expect(got).toMatchObject({
			outcome: "deny",
			note: { status: "waiting" },
		});
	});

	test("approval.requested and approval.resolved are enqueued for uplink", async () => {
		const { events, approvals } = await setup({
			onAsk: resolveFirst("approved"),
		});
		await approvals.awaitRemoteApproval(ask(), LONG, HOOK);
		expect(events.map((e) => e.type)).toEqual([
			"approval.requested",
			"approval.resolved",
		]);
		const [requested, resolved] = events;
		expect(requested?.data).toEqual({
			actionClass: "git.push.protected",
			policyHash: POLICY_HASH,
			expiresAt: new Date(NOW + LONG.timeoutMs).toISOString(),
		});
		expect(resolved?.data).toMatchObject({ resolution: "approved" });
		// Both are the pinned schema's metadata events.
		for (const e of events) {
			const checked = parseWire("event", {
				eventId: "evt_1",
				seq: 1,
				ts: new Date(NOW).toISOString(),
				dataClass: "metadata",
				...e,
			});
			expect(checked.ok).toBe(true);
		}
	});

	test("a local route never reaches the cloud", async () => {
		const { cloud, approvals } = await setup();
		const got = await approvals.awaitRemoteApproval(
			ask(),
			{ ...LONG, target: "local" },
			HOOK,
		);
		expect(got.outcome).toBe("ask-local");
		expect(cloud.state.askCalls).toBe(0);
	});
});

describe("an unreachable cloud never yields allow", () => {
	type Failure = (s: Setup) => void;
	const failures: Readonly<Record<string, Failure>> = {
		offline: (s) => {
			s.cloud.state.offline = true;
		},
		"hub outage": (s) => {
			s.cloud.state.approvalsRefuse = "internal";
		},
		revoked: (s) => {
			s.cloud.state.revoked = true;
		},
		"store unreadable": (s) => s.breakStore(),
	};

	// A small property test: every failure, route and class, over many seeds.
	test("for every failure, route and class", async () => {
		let seed = 593;
		const random = () => {
			seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
			return seed / 2_147_483_648;
		};
		for (let i = 0; i < 24; i++) {
			const names = Object.keys(failures);
			const name = names[Math.floor(random() * names.length)] ?? "offline";
			const enrolled = random() > 0.15;
			const s = await setup({ enrol: enrolled });
			if (enrolled) failures[name]?.(s);
			const route: ApprovalRoute = {
				target: "remote",
				timeoutMs: random() > 0.5 ? 30 : LONG.timeoutMs,
				onTimeout: random() > 0.5 ? "deny" : "ask-local",
			};
			const got = await s.approvals.awaitRemoteApproval(
				ask({ irreversible: random() > 0.5 }),
				route,
				{ timeoutMs: Math.floor(random() * 80) },
			);
			expect(got.outcome).not.toBe("allow");
			expect(["deny", "ask-local"]).toContain(got.outcome);
		}
	});

	test("an unreachable cloud resolves per the route", async () => {
		const s = await setup();
		s.cloud.state.offline = true;
		const denied = await s.approvals.awaitRemoteApproval(ask(), LONG, HOOK);
		expect(denied).toMatchObject({
			outcome: "deny",
			note: { status: "unavailable" },
		});
		const asked = await s.approvals.awaitRemoteApproval(
			ask(),
			{ ...LONG, onTimeout: "ask-local" },
			HOOK,
		);
		expect(asked.outcome).toBe("ask-local");
	});
});
