/**
 * ADR hygiene guard (#295).
 *
 * Architecture decision records live in `adr/NNNN-slug.md`. Numbers are
 * identifiers: two ADRs sharing a number makes "see ADR 0023" ambiguous,
 * so this suite pins the invariants the renumbering established:
 *
 *   - every ADR file is named `NNNN-slug.md` and its H1 carries the same number
 *   - numbers are unique and contiguous from 0001
 *   - `adr/README.md` indexes every ADR exactly once and links nothing stale
 *   - no tracked file references an ADR slug that does not exist
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const ADR_DIR = join(ROOT, "adr");
const ADR_FILE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

const adrFiles = readdirSync(ADR_DIR)
	.filter((f) => f.endsWith(".md") && f !== "README.md")
	.sort();

const numberOf = (file: string): string => file.slice(0, 4);

describe("adr/ numbering", () => {
	test("every ADR file is named NNNN-slug.md", () => {
		const bad = adrFiles.filter((f) => !ADR_FILE.test(f));
		expect(bad).toEqual([]);
	});

	test("ADR numbers are unique", () => {
		const seen = new Map<string, string[]>();
		for (const f of adrFiles) {
			const n = numberOf(f);
			seen.set(n, [...(seen.get(n) ?? []), f]);
		}
		const duplicates = [...seen.values()].filter((files) => files.length > 1);
		expect(duplicates).toEqual([]);
	});

	test("ADR numbers are contiguous from 0001", () => {
		const numbers = adrFiles.map((f) => Number.parseInt(numberOf(f), 10));
		const expected = numbers.map((_, i) => i + 1);
		expect(numbers).toEqual(expected);
	});

	test("each ADR heading carries its file number", () => {
		const mismatched = adrFiles.filter((f) => {
			const firstLine = readFileSync(join(ADR_DIR, f), "utf-8").split("\n")[0];
			return !firstLine?.startsWith(`# ${numberOf(f)}. `);
		});
		expect(mismatched).toEqual([]);
	});
});

describe("adr/README.md index", () => {
	const readmePath = join(ADR_DIR, "README.md");

	test("exists", () => {
		expect(existsSync(readmePath)).toBe(true);
	});

	test("links every ADR exactly once", () => {
		const readme = existsSync(readmePath)
			? readFileSync(readmePath, "utf-8")
			: "";
		const linked = [...readme.matchAll(/\]\(\.?\/?(\d{4}-[a-z0-9-]+\.md)\)/g)]
			.map((m) => m[1] ?? "")
			.sort();
		expect(linked).toEqual(adrFiles);
	});
});

describe("ADR cross-references", () => {
	/**
	 * Receipts are content-addressed, immutable artifacts: rewriting them
	 * would break their hashes, so they are excluded from the scan. Test
	 * fixtures use made-up ADR names on purpose. Golden decision fixtures
	 * are recorded 1.x inputs/outputs: rewriting them would change what the
	 * goldens replay, so historical ADR names inside them are data.
	 */
	const EXCLUDED = [/^\.maina\/receipts\//, /\/__tests__\//, /\/__golden__\//];
	const TEXT = /\.(md|mdx|astro|json)$/;
	const SLUG = String.raw`(\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*)`;
	/** `adr/0034-wiki-is-a-view` anywhere, including `/adr/...` site links. */
	const ADR_PATH_REF = new RegExp(String.raw`(?<![\w-])adr/${SLUG}`, "g");
	/** Relative links between ADRs: `[ADR 0042](0042-slug.md)`. */
	const SIBLING_LINK = new RegExp(String.raw`\]\(\.?/?${SLUG}\.md\)`, "g");

	const tracked = (): string[] => {
		const proc = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT });
		return proc.stdout
			.toString()
			.split("\n")
			.filter((f) => TEXT.test(f) && !EXCLUDED.some((re) => re.test(f)));
	};

	test("every adr/ reference resolves to an existing ADR", () => {
		const known = new Set(adrFiles.map((f) => f.replace(/\.md$/, "")));
		const stale: string[] = [];
		for (const file of tracked()) {
			const path = join(ROOT, file);
			if (!existsSync(path)) continue;
			const content = readFileSync(path, "utf-8");
			const refs = [...content.matchAll(ADR_PATH_REF)];
			if (file.startsWith("adr/")) {
				refs.push(...content.matchAll(SIBLING_LINK));
			}
			for (const m of refs) {
				const slug = m[1] ?? "";
				if (!known.has(slug)) stale.push(`${file}: ${slug}`);
			}
		}
		expect(stale).toEqual([]);
	});
});
