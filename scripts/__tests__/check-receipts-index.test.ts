/**
 * Unit tests for the receipts index integrity check (#269).
 *
 * Each test sets up a temp directory with hand-crafted receipts +
 * index.html, runs the checker, and asserts on the structured result
 * (so the same logic can be reused from CI without parsing stderr).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkReceiptsIndex, isClean } from "../check-receipts-index";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function buildIndex(hashes: string[]): string {
	const links = hashes
		.map(
			(h) =>
				`<tr><td><a href="./${h}/index.html">PR ${h.slice(0, 6)}</a></td></tr>`,
		)
		.join("\n");
	return `<!DOCTYPE html><html><body><table>${links}</table></body></html>`;
}

let tmp: string;

beforeEach(() => {
	tmp = join(
		"/tmp",
		`maina-receipts-check-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeReceipt(hash: string, files: { html?: boolean; json?: boolean }) {
	mkdirSync(join(tmp, hash), { recursive: true });
	if (files.html !== false) {
		writeFileSync(join(tmp, hash, "index.html"), "<html></html>", "utf-8");
	}
	if (files.json !== false) {
		writeFileSync(join(tmp, hash, "receipt.json"), "{}", "utf-8");
	}
}

describe("checkReceiptsIndex", () => {
	test("clean run when every link resolves", () => {
		writeReceipt(HASH_A, {});
		writeReceipt(HASH_B, {});
		const indexPath = join(tmp, "index.html");
		writeFileSync(indexPath, buildIndex([HASH_A, HASH_B]), "utf-8");

		const result = checkReceiptsIndex(indexPath, tmp);
		expect(isClean(result)).toBe(true);
	});

	test("flags missing directories", () => {
		writeReceipt(HASH_A, {});
		// HASH_B is in the index but never written to disk.
		const indexPath = join(tmp, "index.html");
		writeFileSync(indexPath, buildIndex([HASH_A, HASH_B]), "utf-8");

		const result = checkReceiptsIndex(indexPath, tmp);
		expect(isClean(result)).toBe(false);
		expect(result.missingDirs).toEqual([HASH_B]);
	});

	test("flags directories missing index.html or receipt.json", () => {
		writeReceipt(HASH_A, { html: false });
		writeReceipt(HASH_B, { json: false });
		const indexPath = join(tmp, "index.html");
		writeFileSync(indexPath, buildIndex([HASH_A, HASH_B]), "utf-8");

		const result = checkReceiptsIndex(indexPath, tmp);
		expect(result.missingHtml).toEqual([HASH_A]);
		expect(result.missingJson).toEqual([HASH_B]);
		expect(isClean(result)).toBe(false);
	});

	test("flags duplicate links", () => {
		writeReceipt(HASH_A, {});
		const indexPath = join(tmp, "index.html");
		// Same hash linked twice — the on-disk dir is fine, but the index
		// is malformed.
		writeFileSync(indexPath, buildIndex([HASH_A, HASH_A]), "utf-8");

		const result = checkReceiptsIndex(indexPath, tmp);
		expect(result.duplicateHashes).toEqual([HASH_A]);
		expect(isClean(result)).toBe(false);
	});

	test("ignores hashes that don't match the 64-hex pattern", () => {
		writeReceipt(HASH_A, {});
		const indexPath = join(tmp, "index.html");
		// Add a stray short link that the regex shouldn't match — the
		// checker should ignore it cleanly rather than blow up.
		const html = `${buildIndex([HASH_A])}<a href="./not-hex/index.html">x</a>`;
		writeFileSync(indexPath, html, "utf-8");

		const result = checkReceiptsIndex(indexPath, tmp);
		expect(isClean(result)).toBe(true);
	});

	test("handles an empty index (no receipt links yet)", () => {
		const indexPath = join(tmp, "index.html");
		writeFileSync(indexPath, "<!DOCTYPE html><html></html>", "utf-8");

		const result = checkReceiptsIndex(indexPath, tmp);
		expect(isClean(result)).toBe(true);
	});

	test("aggregates several failure modes in one run", () => {
		writeReceipt(HASH_A, {}); // ok
		writeReceipt(HASH_B, { html: false }); // missing html
		// HASH_C: not written at all
		const indexPath = join(tmp, "index.html");
		writeFileSync(indexPath, buildIndex([HASH_A, HASH_B, HASH_C]), "utf-8");

		const result = checkReceiptsIndex(indexPath, tmp);
		expect(result.missingHtml).toEqual([HASH_B]);
		expect(result.missingDirs).toEqual([HASH_C]);
		expect(result.missingJson).toEqual([]);
		expect(isClean(result)).toBe(false);
	});
});
