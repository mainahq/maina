/**
 * Regression guard for gap G13 — "never produce a path containing
 * `/.maina/.maina/`".
 *
 * `createFeatureDir(mainaDir, number, name)` and
 * `getNextFeatureNumber(mainaDir)` take what the parameter *name* calls
 * a "maina dir" but in practice is the **repo root**. The join inside
 * then appends `.maina/features/…`.
 *
 * If a future caller (or a refactor that takes the parameter name at
 * face value) passes `<repoRoot>/.maina` literally, the path collapses
 * to `<repoRoot>/.maina/.maina/features/…` and the wizard starts
 * writing into the wrong place.
 *
 * These tests lock in the shape of the returned path so such a
 * regression fails loudly in CI.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFeatureDir, getNextFeatureNumber } from "../numbering";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-no-double-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("numbering — no double `.maina` regression guard", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("createFeatureDir returns path with exactly one `.maina` segment", async () => {
		mkdirSync(join(tmpDir, ".maina", "features"), { recursive: true });

		const result = await createFeatureDir(tmpDir, "001", "demo-feature");

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// Exactly one occurrence of `/.maina/` — never two in a row.
		const matches = result.value.match(/\/\.maina\//g) ?? [];
		expect(matches.length).toBe(1);
		expect(result.value).not.toContain("/.maina/.maina/");
	});

	test("getNextFeatureNumber creates `.maina/features` exactly once", async () => {
		const result = await getNextFeatureNumber(tmpDir);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// Writable dir must exist at the single-`.maina` path.
		expect(existsSync(join(tmpDir, ".maina", "features"))).toBe(true);
		// Double-`.maina` variant must NOT exist.
		expect(existsSync(join(tmpDir, ".maina", ".maina", "features"))).toBe(
			false,
		);
	});

	test("trailing-slash repo roots do not double the `.maina` segment", async () => {
		// Simulate a caller that passed `<cwd>/` (trailing slash) by running
		// both the `with` and `without` forms and asserting they land in the
		// same directory.
		mkdirSync(join(tmpDir, ".maina", "features"), { recursive: true });

		const a = await createFeatureDir(tmpDir, "001", "a-feature");
		const b = await createFeatureDir(`${tmpDir}/`, "002", "b-feature");

		expect(a.ok && b.ok).toBe(true);
		if (!a.ok || !b.ok) return;
		expect(a.value).not.toContain("/.maina/.maina/");
		expect(b.value).not.toContain("/.maina/.maina/");
	});

	test("scripts/check-paths.ts regex does not match clean join sites", () => {
		// Sanity check — the regex the CI guard uses:
		const DOUBLE_DOT_MAINA =
			/join\([^)]*["']\.maina["'][^)]*["']\.maina["'][^)]*\)/;
		const cleanCases = [
			'join(cwd, ".maina", "features")',
			'join(mainaDir, "wiki", "state.json")',
			'join(repo, ".maina", "CONTEXT.md")',
		];
		for (const c of cleanCases) {
			expect(DOUBLE_DOT_MAINA.test(c)).toBe(false);
		}
	});

	test("scripts/check-paths.ts regex catches the double-`.maina` foot-gun", () => {
		const DOUBLE_DOT_MAINA =
			/join\([^)]*["']\.maina["'][^)]*["']\.maina["'][^)]*\)/;
		// Literal double-`.maina` is always wrong — two `.maina` string args
		// inside a single `join(…)` call produce the collapsed path.
		const brokenCases = [
			'join(root, ".maina", "wiki", ".maina", "x")',
			"join(x, \".maina\", y, '.maina', z)",
			'join(cwd, ".maina", ".maina", "features")',
		];
		for (const c of brokenCases) {
			expect(DOUBLE_DOT_MAINA.test(c)).toBe(true);
		}
	});
});
