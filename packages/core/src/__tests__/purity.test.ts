/**
 * Functional-core purity ratchet (issue #289).
 *
 * Statically scans every non-test source file under `packages/core/src` for
 * the side effects the functional core forbids (`process.cwd`, `process.env`,
 * `process.stdout`, `console.*`, `throw`). Files that offended when the
 * ratchet was introduced are listed, with per-rule counts, in
 * `purity-allowlist.ts`. The ratchet only turns one way:
 *
 * - a new offending file, or a higher count in a listed file, fails;
 * - a lower count (or a clean / deleted file) also fails until the
 *   allow-list entry is lowered or removed, so progress is locked in.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { PURITY_ALLOWLIST } from "./purity-allowlist";
import {
	type PurityRule,
	type PurityViolation,
	scanSource,
} from "./purity-scanner";

const CORE_SRC = join(import.meta.dir, "..");

function listSourceFiles(dir: string): readonly string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			return name === "__tests__" || name === "node_modules"
				? []
				: listSourceFiles(full);
		}
		return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : [];
	});
}

type FileReport = Readonly<{
	file: string;
	violations: readonly PurityViolation[];
}>;

function scanCore(): readonly FileReport[] {
	return listSourceFiles(CORE_SRC)
		.map((full) => ({
			file: relative(CORE_SRC, full).split(sep).join("/"),
			violations: scanSource(readFileSync(full, "utf8")),
		}))
		.filter((report) => report.violations.length > 0);
}

function countByRule(
	violations: readonly PurityViolation[],
): Partial<Record<PurityRule, number>> {
	const counts: Partial<Record<PurityRule, number>> = {};
	for (const v of violations) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
	return counts;
}

function formatEntry(
	file: string,
	counts: Partial<Record<PurityRule, number>>,
): string {
	const body = Object.entries(counts)
		.map(([rule, n]) => `"${rule}": ${n}`)
		.join(", ");
	return `\t"${file}": { ${body} },`;
}

describe("purity scanner", () => {
	test("flags each forbidden construct with its line", () => {
		const source = [
			"const root = process.cwd();",
			"const key = process.env.KEY;",
			"process.stdout.write('x');",
			"console.error('boom');",
			"throw new Error('nope');",
		].join("\n");
		expect(scanSource(source)).toEqual([
			{ rule: "process.cwd", line: 1 },
			{ rule: "process.env", line: 2 },
			{ rule: "process.stdout", line: 3 },
			{ rule: "console", line: 4 },
			{ rule: "throw", line: 5 },
		]);
	});

	test("ignores comments, strings, template text and regex literals", () => {
		const source = [
			"// throw new Error() in a comment",
			"/* console.log('block') */",
			"const a = 'process.env.X';",
			'const b = "console.log(1)";',
			"const c = `we never throw here`;",
			"const d = /throw|console\\./;",
			"const e = x / 2; // throw",
		].join("\n");
		expect(scanSource(source)).toEqual([]);
	});

	test("scans code inside template literal expressions", () => {
		const source = `const s = \`cwd: \${process.cwd()} \${\`\${console.log}\`}\`;`;
		expect(scanSource(source)).toEqual([
			{ rule: "process.cwd", line: 1 },
			{ rule: "console", line: 1 },
		]);
	});

	test("does not flag member access such as gen.throw() or this.console", () => {
		const source = [
			"gen.throw(err);",
			"this.console.log(x);",
			"const throwsError = true;",
			"const processed = env.cwd;",
		].join("\n");
		expect(scanSource(source)).toEqual([]);
	});

	test("flags optional chaining, globalThis access and spreads", () => {
		const source = [
			"const a = process?.env;",
			"const b = globalThis.process.env.HOME;",
			"globalThis.console.warn('w');",
			"const env = { ...process.env, A: '1' };",
		].join("\n");
		expect(scanSource(source).map((v) => v.rule)).toEqual([
			"process.env",
			"process.env",
			"console",
			"process.env",
		]);
	});
});

describe("functional core purity ratchet", () => {
	const reports = scanCore();

	test("no new offenders beyond the allow-list", () => {
		const regressions = reports.flatMap(({ file, violations }) => {
			const allowed = PURITY_ALLOWLIST[file] ?? {};
			const counts = countByRule(violations);
			const over = Object.entries(counts).filter(
				([rule, n]) => n > (allowed[rule as PurityRule] ?? 0),
			);
			if (over.length === 0) return [];
			const lines = violations
				.filter((v) => over.some(([rule]) => rule === v.rule))
				.map((v) => `${file}:${v.line} ${v.rule}`);
			return [...lines, `  current counts -> ${formatEntry(file, counts)}`];
		});
		// New functional-core purity violations: route the side effect through
		// CorePorts / return a Result instead of growing the allow-list.
		expect(regressions.join("\n")).toBe("");
	});

	test("allow-list has no stale entries (ratchet only goes down)", () => {
		const byFile = new Map(
			reports.map((r) => [r.file, countByRule(r.violations)]),
		);
		const stale = Object.entries(PURITY_ALLOWLIST).flatMap(
			([file, allowed]) => {
				const counts = byFile.get(file) ?? {};
				const lowered = Object.entries(allowed).some(
					([rule, n]) => (counts[rule as PurityRule] ?? 0) < (n ?? 0),
				);
				if (!lowered) return [];
				return byFile.has(file)
					? [`lower -> ${formatEntry(file, counts)}`]
					: [`remove -> "${file}" (no violations left)`];
			},
		);
		// Stale allow-list: tighten purity-allowlist.ts as suggested.
		expect(stale.join("\n")).toBe("");
	});
});
