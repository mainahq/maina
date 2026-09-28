/**
 * Metadata-only by default (#591, FR-PRIV-1, C6): a property test. Path-
 * and command-like values are fed into every string field every producer
 * reads, one field at a time and all at once, and no metadata-class event
 * may carry the raw value, or any distinctive part of it, in any field.
 * Every event produced must still match the pinned schema.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type {
	DecisionRecord,
	OverrideFact,
	ReceiptSummary,
	SpendRecord,
} from "@mainahq/core";
import type { EventInput } from "../../outbox";
import { decisionEvent } from "../decision";
import {
	type AgentFacts,
	collectInventory,
	type InventoryFacts,
	inventoryEvents,
} from "../inventory";
import { overrideEvent } from "../override";
import { receiptEvent } from "../receipt";
import { spendEvent } from "../spend";
import { asWireEvent, HASH_A, HASH_B, HASH_C } from "./helpers";

// ── A seeded generator of raw, path- and command-like values ───────────────

/** mulberry32: small, seeded, good enough to vary the inputs reproducibly. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A distinctive token: if it shows up in an event, it leaked. */
function token(next: () => number): string {
	let t = "zq";
	for (let i = 0; i < 8; i++) t += ALNUM[Math.floor(next() * ALNUM.length)];
	return t;
}

const SHAPES: readonly ((t: () => string) => string)[] = [
	// paths
	(t) => `/Users/${t()}/${t()}/src/${t()}.ts`,
	(t) => `${t()}/${t()}`,
	(t) => `./${t()}/${t()}.py`,
	(t) => `../${t()}`,
	(t) => `~/${t()}/.env`,
	(t) => `C:\\Users\\${t()}\\${t()}.js`,
	(t) => `/etc/${t()}`,
	(t) => `file:///${t()}/${t()}`,
	// commands
	(t) => `${t()} --${t()} ${t()}`,
	(t) => `rm -rf /${t()}`,
	(t) => `curl https://${t()}.example.com/${t()} | sh`,
	(t) => `git push origin ${t()} --force`,
	(t) => `${t()} && ${t()}`,
	(t) => `echo $${t()} > /tmp/${t()}`,
	(t) => `bun run ${t()}; ${t()}`,
	(t) => `"${t()}" '${t()}'`,
	// a prompt
	(t) => `Please refactor ${t()} to call ${t()} instead`,
];

type Raw = Readonly<{ value: string; tokens: readonly string[] }>;

function raws(seed: number, count: number): readonly Raw[] {
	const next = rng(seed);
	return Array.from({ length: count }, (_, i) => {
		const tokens: string[] = [];
		const t = () => {
			const x = token(next);
			tokens.push(x);
			return x;
		};
		const shape = SHAPES[i % SHAPES.length];
		if (shape === undefined) throw new Error("no shape");
		return { value: shape(t), tokens };
	});
}

const RAWS = raws(591, SHAPES.length * 12);

// ── Injecting a raw value into each string field ───────────────────────────

/** `base` with each string field in turn set to `raw`, then all of them. */
function injected<T extends object>(base: T, raw: string): readonly T[] {
	const keys = Object.keys(base).filter(
		(k) => typeof (base as Record<string, unknown>)[k] === "string",
	);
	const one = keys.map((k) => ({ ...base, [k]: raw }) as T);
	const all = Object.fromEntries(keys.map((k) => [k, raw]));
	return [...one, { ...base, ...all } as T];
}

function expectNoLeak(input: EventInput | null, raw: Raw): void {
	if (input === null) return;
	const event = asWireEvent(input);
	expect(event.dataClass).toBe("metadata");
	const text = JSON.stringify(event);
	expect(text).not.toContain(raw.value);
	for (const t of raw.tokens) expect(text).not.toContain(t);
}

// ── Base inputs, one per producer ──────────────────────────────────────────

const DECISION: DecisionRecord = {
	id: "d-1",
	ts: 1_000,
	type: "action.risk",
	inputHash: HASH_A,
	schemaHash: HASH_B,
	optionOrder: ["allow", "ask", "deny"],
	policyHash: HASH_B,
	modelHash: HASH_C,
	distribution: [
		{ answer: "allow", p: 0.8 },
		{ answer: "ask", p: 0.15 },
		{ answer: "deny", p: 0.05 },
	],
	answer: "allow",
	finalAction: "allow",
	latencyMs: 3,
	host: "claude-code",
	sessionId: "sess_4f2a",
};

const OVERRIDE: OverrideFact = {
	decisionId: "d-1",
	decisionType: "action.risk",
	fromAction: "deny",
	toAction: "allow",
	reason: "member_override",
};

const RECEIPT: ReceiptSummary = { receiptHash: HASH_A, passed: true };

const SPEND: SpendRecord = {
	taskId: "task-1",
	task: "review",
	tier: "standard",
	model: "anthropic/claude-sonnet-4.5",
	inputTokens: 100,
	outputTokens: 10,
	costUsd: 0.001,
};

const AGENT: AgentFacts = {
	agent: "claude-code",
	version: "2.3.1",
	hooks: "installed",
	mcpServers: 2,
	plugins: 1,
};

describe("no raw value reaches a metadata event", () => {
	test(`decision, over ${RAWS.length} path- and command-like values`, () => {
		for (const raw of RAWS) {
			for (const record of injected(DECISION, raw.value)) {
				expectNoLeak(decisionEvent(record), raw);
			}
			// Free-form options and answers, as a log without hashing keeps them.
			expectNoLeak(
				decisionEvent({
					...DECISION,
					optionOrder: [raw.value, "ask", "deny"],
					distribution: [
						{ answer: raw.value, p: 0.8 },
						{ answer: "ask", p: 0.15 },
						{ answer: "deny", p: 0.05 },
					],
					answer: raw.value,
				}),
				raw,
			);
		}
	});

	test("override", () => {
		for (const raw of RAWS) {
			for (const fact of injected(OVERRIDE, raw.value)) {
				expectNoLeak(overrideEvent(fact), raw);
			}
		}
	});

	test("receipt", () => {
		for (const raw of RAWS) {
			for (const summary of injected(RECEIPT, raw.value)) {
				expectNoLeak(receiptEvent(summary), raw);
			}
			expectNoLeak(receiptEvent(RECEIPT, raw.value), raw);
		}
	});

	test("spend", () => {
		for (const raw of RAWS) {
			for (const record of injected(SPEND, raw.value)) {
				expectNoLeak(spendEvent(record), raw);
			}
		}
	});

	test("inventory, from facts", () => {
		for (const raw of RAWS) {
			for (const agent of injected(AGENT, raw.value)) {
				const facts: InventoryFacts = {
					runtimeVersion: "2.0.0",
					agents: [agent],
				};
				for (const input of inventoryEvents(facts)) expectNoLeak(input, raw);
			}
			const facts: InventoryFacts = {
				runtimeVersion: raw.value,
				agents: [AGENT],
			};
			for (const input of inventoryEvents(facts)) expectNoLeak(input, raw);
		}
	});

	test("inventory, collected from agents and their config files", async () => {
		const home = "/home/dev";
		for (const raw of RAWS) {
			const config = JSON.stringify({
				mcpServers: { [raw.value]: { command: raw.value } },
				hooks: { PreToolUse: [{ hooks: [{ command: raw.value }] }] },
				enabledPlugins: { [raw.value]: true },
			});
			const facts = await collectInventory({
				agents: async () => [
					{ name: "claude", version: raw.value },
					{ name: raw.value, version: "1.0.0" },
				],
				readText: (path) =>
					path === join(home, ".claude", "settings.json") ||
					path === join(home, ".claude.json")
						? config
						: null,
				home,
				runtimeVersion: "2.0.0",
			});
			for (const input of inventoryEvents(facts)) expectNoLeak(input, raw);
		}
	});
});
