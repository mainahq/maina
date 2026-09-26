/**
 * The shareable digest card (#350, FR-RET-5). By default it carries numbers
 * and Maina's own vocabulary only: whatever code, paths or repository names
 * reach the events (tool names, rule text), none of it reaches the card.
 * Random inputs come from a seeded generator so a failure reproduces; the
 * seed is in the test name.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTION_CLASS_IDS } from "../../policy/defaults";
import {
	buildDigest,
	type DigestEvent,
	type DigestVerdict,
	gateLogEvents,
	parseGateLog,
} from "../build";
import { renderDigestCard } from "../card";

const LOG = readFileSync(
	join(import.meta.dir, "fixtures/gate-log.jsonl"),
	"utf-8",
);
const WEEK = "2026-39";
const TS = Date.parse("2026-09-23T12:00:00.000Z");

describe("renderDigestCard", () => {
	const digest = buildDigest(gateLogEvents(parseGateLog(LOG).records), WEEK);

	test("shows the week's headline numbers", () => {
		const card = renderDigestCard(digest);
		expect(card).toContain(WEEK);
		expect(card).toContain("12 agent actions checked");
		expect(card).toContain("4 blocked, 4 asked, 4 allowed");
		expect(card).toContain("2 overrides");
		expect(card).toContain("1 crash");
	});

	test("names the most blocked Maina action class, never the rule text", () => {
		const card = renderDigestCard(digest);
		expect(card).toContain("Most blocked: gate.self_override (2)");
		expect(card).not.toContain("an agent may not change its own gate");
	});

	test("leaves tool names out unless labels are asked for", () => {
		expect(renderDigestCard(digest)).not.toContain("Bash");
		const labelled = renderDigestCard(digest, { includeLabels: true });
		expect(labelled).toContain("Bash (6)");
	});

	test("a quiet week still renders", () => {
		const card = renderDigestCard(buildDigest([], "2026-10"));
		expect(card).toContain("0 agent actions checked");
		expect(card).not.toContain("Most blocked");
	});
});

// ── Property test ───────────────────────────────────────────────────────────

const SEED = 0x5eed350;
const RUNS = 300;

/** mulberry32: a tiny deterministic PRNG. */
function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

const FRAGMENTS = [
	"const ",
	"function ",
	"return ",
	"=> ",
	"{ ",
	"} ",
	"(",
	")",
	";",
	"\n",
	" = ",
	'"',
	"`${",
	"// ",
	"process.env.SECRET",
	"SELECT * FROM users",
	"<script>",
	"é",
	"\\",
];

type Next = () => number;

const pick = <T>(next: Next, xs: readonly T[]): T =>
	xs[Math.floor(next() * xs.length)] as T;

const ident = (next: Next): string =>
	Array.from({ length: 4 + Math.floor(next() * 8) }, () =>
		pick(next, [
			..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$0123456789",
		]),
	).join("");

function randomCode(next: Next): string {
	const parts = Array.from({ length: 4 + Math.floor(next() * 10) }, () =>
		next() < 0.5 ? pick(next, FRAGMENTS) : ident(next),
	);
	return `${ident(next)}(${parts.join("")});`;
}

const seg = (next: Next): string => Math.floor(next() * 1e9).toString(36);

function randomPath(next: Next): string {
	return next() < 0.5
		? `src/${seg(next)}/${seg(next)}-${seg(next)}.ts`
		: `/Users/${seg(next)}/work/${seg(next)}.json`;
}

function randomRepo(next: Next): string {
	return next() < 0.5
		? `${seg(next)}-org/${seg(next)}-app`
		: `acme-${seg(next)}-${seg(next)}`;
}

/** A free-form string an event may carry, and the secrets inside it. */
function randomLabel(
	next: Next,
): Readonly<{ text: string; secrets: string[] }> {
	const code = randomCode(next);
	const path = randomPath(next);
	const repo = randomRepo(next);
	const cls = pick(next, ACTION_CLASS_IDS);
	switch (Math.floor(next() * 6)) {
		case 0:
			return { text: code, secrets: [code] };
		case 1:
			return { text: path, secrets: [path] };
		case 2:
			return { text: repo, secrets: [repo] };
		case 3:
			// A tool name that embeds the repository.
			return { text: `mcp__${repo}__deploy`, secrets: [repo] };
		case 4:
			// Gate-style rule text: a class, then the subject.
			return { text: `${cls}: ${path} in ${repo}`, secrets: [path, repo] };
		default:
			return { text: `${cls} is irreversible (${code})`, secrets: [code] };
	}
}

const VERDICTS: readonly DigestVerdict[] = ["allow", "ask", "deny"];
const CATALOG: ReadonlySet<string> = new Set(ACTION_CLASS_IDS);
/** Anything shaped like a path, code or a slug: slashes, quotes, brackets, `=`, `;`. */
const UNSAFE_CHARS = /[/\\;{}=<>"'`$[\]\t]/;

describe(`renderDigestCard — property (seed ${SEED.toString(16)})`, () => {
	test(`no code, path or repo name reaches the card in ${RUNS} random weeks`, () => {
		const next = prng(SEED);
		for (let run = 0; run < RUNS; run++) {
			const secrets: string[] = [];
			const events: DigestEvent[] = Array.from(
				{ length: 1 + Math.floor(next() * 25) },
				() => {
					const tool = randomLabel(next);
					const rule = randomLabel(next);
					secrets.push(...tool.secrets, ...rule.secrets);
					return {
						ts: TS,
						tool: tool.text,
						verdict: pick(next, VERDICTS),
						rule: rule.text,
						override: next() < 0.2,
						crash: next() < 0.1,
					};
				},
			);
			const card = renderDigestCard(buildDigest(events, WEEK));
			const leaked = secrets.filter((s) => card.includes(s));
			expect({ run, leaked }).toEqual({ run, leaked: [] });
			expect({ run, unsafe: UNSAFE_CHARS.test(card) }).toEqual({
				run,
				unsafe: false,
			});
			// Every dotted or underscored word is Maina vocabulary.
			const labels = card
				.split(/[\s(),:]+/)
				.filter((w) => /[._]/.test(w) && !/^\d+(\.\d+)?%?$/.test(w));
			const foreign = labels.filter(
				(w) => !CATALOG.has(w) && w !== "mainahq.com",
			);
			expect({ run, foreign }).toEqual({ run, foreign: [] });
		}
	});
});
