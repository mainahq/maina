/**
 * Reads `bun test --reporter=junit` output into one entry per test case
 * (v1 task 12.1, #558). Bun writes a flat, predictable report, so a small
 * reader over its `<testcase>` elements is enough; no XML dependency.
 */

import type { Result } from "./shell";

export type TestStatus = "passed" | "failed" | "skipped";

type TestCase = Readonly<{
	/** The enclosing `describe` (JUnit `classname`); empty at top level. */
	suite: string;
	name: string;
	status: TestStatus;
}>;

const ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

function decode(s: string): string {
	return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
		const key = String(e);
		if (key.startsWith("#x") || key.startsWith("#X")) {
			return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
		}
		if (key.startsWith("#")) {
			return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
		}
		return ENTITIES[key.toLowerCase()] ?? "";
	});
}

function attr(attrs: string, name: string): string {
	const m = new RegExp(`\\s${name}="([^"]*)"`).exec(attrs);
	return decode(m?.[1] ?? "");
}

/** A `<testcase .../>` or `<testcase ...>body</testcase>`. */
const TESTCASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;

export function parseJunit(xml: string): Result<readonly TestCase[], string> {
	if (!/<testsuites?\b/.test(xml)) {
		return { ok: false, error: "not a JUnit report (no <testsuites>)" };
	}
	const cases: TestCase[] = [];
	for (const m of xml.matchAll(TESTCASE)) {
		const attrs = m[1] ?? "";
		const body = m[2] ?? "";
		const status: TestStatus = /<(failure|error)\b/.test(body)
			? "failed"
			: /<skipped\b/.test(body)
				? "skipped"
				: "passed";
		cases.push({
			suite: attr(attrs, "classname"),
			name: attr(attrs, "name"),
			status,
		});
	}
	return { ok: true, value: cases };
}

export type Tally = Readonly<Record<TestStatus, number>>;

export function tally(cases: readonly TestCase[]): Tally {
	const t = { passed: 0, failed: 0, skipped: 0 };
	for (const c of cases) t[c.status]++;
	return t;
}
