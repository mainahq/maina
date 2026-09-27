/**
 * Input-contract drift guard (#582). The `action.risk` request the gate
 * builds (`riskRequest`) is what the System 1 model is trained on: its
 * trusted and untrusted key sets are pinned here per encoding version.
 *
 * Adding, removing or renaming a key changes what the model sees, so it
 * needs a coordinated `ENCODING_VERSION` bump in maina and maina-model: add
 * a new entry to `PINNED` for the new version, never edit an existing one.
 *
 * The same requests are checked against the normalisation the model applies
 * (root, home, session id, base question id): the gate's two orders must
 * canonicalise to the same texts and measure into the same length bucket.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import {
	baseQuestionId,
	canonicalTexts,
	DROPPED_UNTRUSTED,
	ENCODING_VERSION,
	REVERSED_SUFFIX,
	ROOT_FIELD,
	SET_VALUED_TRUSTED,
} from "../../decide/encoding";
import { approxTokens, lengthBucket } from "../../decide/evidence";
import { createRegistry, DEFAULT_REGISTRY } from "../../decide/registry";
import type { Backend, DecideRequest } from "../../decide/types";
import { DEFAULT_POLICY } from "../../policy/defaults";
import { type Policy, VERDICTS } from "../../policy/schema";
import { evaluateGate, type GatePorts } from "../evaluate";
import type { GateContext, GateEvent } from "../events";
import {
	gateContext,
	mcpEvent,
	networkEvent,
	readEvent,
	shellEvent,
	writeEvent,
} from "./helpers";

type KeySet = Readonly<{
	/** On every request. */
	required: readonly string[];
	/** On some requests (`actionClass` needs a class, `ruleReason` a rule). */
	optional: readonly string[];
}>;

type Contract = Readonly<{ trusted: KeySet; untrusted: KeySet }>;

/** The pinned `riskRequest` key sets, by encoding version. Append only. */
const PINNED: Readonly<Record<number, Contract>> = {
	1: {
		trusted: {
			required: ["classes", "eventKind", "highRisk", "permissionMode", "rule"],
			optional: ["actionClass"],
		},
		untrusted: {
			required: ["action", "host", "provenance", "root", "sessionId"],
			optional: ["ruleReason"],
		},
	},
};

/** A System 1 stand-in that asks, certain: every event reaches `decide`. */
const asking: Backend = {
	id: "system1",
	version: "test",
	answer: (input) => ({
		ok: true,
		value: input.questions.map((q) => {
			const options = q.kind === "choice" ? q.options : [];
			return {
				answer: "ask",
				distribution: options.map((o) => ({
					answer: o,
					p: o === "ask" ? 1 : 0,
				})),
			};
		}),
	}),
};

const policy: Policy = {
	...DEFAULT_POLICY,
	decisions: {
		...DEFAULT_POLICY.decisions,
		"action.risk": {
			...DEFAULT_POLICY.decisions["action.risk"],
			backend: "system1",
		},
	},
	rules: {
		...DEFAULT_POLICY.rules,
		deny: [...DEFAULT_POLICY.rules.deny, { match: "git status" }],
	},
};

let ctx: GateContext;
beforeAll(async () => {
	ctx = await gateContext();
});

function ports(): GatePorts {
	let n = 0;
	return {
		clock: { now: () => 0 },
		backends: createRegistry([...DEFAULT_REGISTRY.values(), asking]),
		ctx,
		newId: () => `d${++n}`,
	};
}

/** Events covering every rule outcome, event kind and both orders. */
const events = (): readonly GateEvent[] => [
	shellEvent("ls -la"),
	shellEvent("echo hi"),
	shellEvent("git status"),
	shellEvent("rm -rf /"),
	shellEvent("psql -c 'DROP TABLE users'"),
	shellEvent("npm publish"),
	shellEvent("cat README.md", { untrusted: ["web:https://evil.example"] }),
	shellEvent("ls", { permissionMode: "bypass" }),
	writeEvent("/work/repo/src/a.ts", "x"),
	writeEvent("/home/dev/.bashrc"),
	readEvent("/home/dev/.ssh/id_rsa"),
	mcpEvent("db", "query", { sql: "select 1" }),
	networkEvent("https://example.com", "POST"),
];

function requestsOf(event: GateEvent): readonly DecideRequest[] {
	const result = evaluateGate(ports(), event, policy);
	return (result.decided?.answers ?? []).map((a) => a.request);
}

const sorted = (keys: Iterable<string>): string[] => [...keys].sort();

describe("riskRequest input contract", () => {
	const contract = (): Contract => {
		const pinned = PINNED[ENCODING_VERSION];
		if (pinned === undefined) {
			return expect.unreachable(
				`encoding v${ENCODING_VERSION} has no pinned riskRequest keys`,
			) as never;
		}
		return pinned;
	};

	test("the key sets are pinned for this encoding version", () => {
		expect(ENCODING_VERSION).toBe(1);
		expect(PINNED[ENCODING_VERSION]).toBeDefined();
	});

	test("every request carries exactly the pinned keys", () => {
		const { trusted, untrusted } = contract();
		const seen = { trusted: new Set<string>(), untrusted: new Set<string>() };
		let count = 0;
		for (const event of events()) {
			for (const request of requestsOf(event)) {
				count += 1;
				expect(request.type).toBe("action.risk");
				for (const [segment, keys] of [
					["trusted", trusted],
					["untrusted", untrusted],
				] as const) {
					const actual = Object.keys(request.state[segment]);
					for (const key of actual) seen[segment].add(key);
					const allowed = [...keys.required, ...keys.optional];
					const label = `${segment} of ${JSON.stringify(event.action)}`;
					expect(
						actual.filter((k) => !allowed.includes(k)),
						label,
					).toEqual([]);
					expect(
						keys.required.filter((k) => !actual.includes(k)),
						label,
					).toEqual([]);
				}
			}
		}
		expect(count).toBeGreaterThan(events().length);
		// The corpus exercises every optional key, so none can vanish unseen.
		expect(sorted(seen.trusted)).toEqual(
			sorted([...trusted.required, ...trusted.optional]),
		);
		expect(sorted(seen.untrusted)).toEqual(
			sorted([...untrusted.required, ...untrusted.optional]),
		);
	});

	test("trusted values have the pinned kinds", () => {
		for (const event of events()) {
			for (const { state } of requestsOf(event)) {
				const t = state.trusted;
				expect(Array.isArray(t.classes)).toBe(true);
				expect(
					(t.classes as unknown[]).every((c) => typeof c === "string"),
				).toBe(true);
				expect(typeof t.eventKind).toBe("string");
				expect(typeof t.highRisk).toBe("boolean");
				expect(typeof t.permissionMode).toBe("string");
				expect(typeof t.rule).toBe("string");
				if ("actionClass" in t) expect(typeof t.actionClass).toBe("string");
			}
		}
	});

	test("the keys the model normalises are part of the contract", () => {
		const { trusted, untrusted } = contract();
		const untrustedKeys = [...untrusted.required, ...untrusted.optional];
		const trustedKeys = [...trusted.required, ...trusted.optional];
		expect(untrustedKeys).toContain(ROOT_FIELD);
		for (const key of DROPPED_UNTRUSTED) expect(untrustedKeys).toContain(key);
		for (const key of SET_VALUED_TRUSTED) expect(trustedKeys).toContain(key);
	});

	test("one choice question over the verdicts; the second order at its base id", () => {
		const [forward, reversed] = requestsOf(shellEvent("npm publish"));
		expect(forward?.questions).toEqual([
			{ kind: "choice", id: "d1", options: [...VERDICTS] },
		]);
		expect(reversed?.questions).toEqual([
			{
				kind: "choice",
				id: `d1${REVERSED_SUFFIX}`,
				options: [...VERDICTS].reverse(),
			},
		]);
		expect(baseQuestionId(reversed?.questions[0]?.id ?? "")).toBe("d1");
	});
});

describe("riskRequest normalisation parity", () => {
	const FORBIDDEN = ["[CLS]", "[SEP]", "[TRUSTED]", "[UNTRUSTED]"];

	const pairs = (): readonly (readonly [DecideRequest, DecideRequest])[] =>
		events().flatMap((event) => {
			const [a, b] = requestsOf(event);
			return a === undefined || b === undefined ? [] : [[a, b] as const];
		});

	test("the two orders canonicalise to the same texts and bucket", () => {
		expect(pairs().length).toBeGreaterThan(1);
		for (const [forward, reversed] of pairs()) {
			expect(canonicalTexts(reversed.state, FORBIDDEN)).toEqual(
				canonicalTexts(forward.state, FORBIDDEN),
			);
			expect(approxTokens(reversed)).toBe(approxTokens(forward));
			expect(lengthBucket(reversed)).toBe(lengthBucket(forward));
		}
	});

	test("the root, home and session id never reach the canonical texts raw", () => {
		const event = shellEvent("cat /work/repo/a /home/dev/b", {
			sessionId: "session-secret",
		});
		const [request] = requestsOf(event);
		if (request === undefined) return expect.unreachable("no request");
		const texts = canonicalTexts(request.state, FORBIDDEN);
		expect(texts.ok).toBe(true);
		if (!texts.ok) return;
		expect(texts.value.untrusted).not.toContain("/work/repo");
		expect(texts.value.untrusted).not.toContain("/home/dev");
		expect(texts.value.untrusted).not.toContain("session-secret");
		expect(texts.value.untrusted).toContain("⟨root⟩/a ~/b");
	});
});
