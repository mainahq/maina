/**
 * Tests for `bootstrap/scaffold` — the shared scaffolding path for
 * `maina init` and `maina setup`.
 *
 * The key invariant is idempotency: running scaffold twice must produce a
 * byte-identical tree. That is what unblocks re-running `init`/`setup`
 * safely.
 */

import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { scaffold } from "../scaffold";

// ── Helpers ─────────────────────────────────────────────────────────────────

function tmpRepo(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `maina-${prefix}-`));
}

/** Read every file under `dir` recursively into a `{ relPath → content }` map. */
function snapshotTree(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	walk(dir, dir, out);
	return out;
}

function walk(
	root: string,
	current: string,
	out: Record<string, string>,
): void {
	for (const entry of readdirSync(current)) {
		const full = join(current, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			walk(root, full, out);
		} else {
			out[relative(root, full)] = readFileSync(full, "utf-8");
		}
	}
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("scaffold", () => {
	test("writes the minimal .maina tree when called on an empty dir", async () => {
		const cwd = tmpRepo("scaffold-empty");
		try {
			const res = await scaffold({ cwd, withPrompts: true });
			expect(res.ok).toBe(true);
			if (!res.ok) return;

			expect(existsSync(join(cwd, ".maina"))).toBe(true);
			expect(existsSync(join(cwd, ".maina/prompts/review.md"))).toBe(true);
			expect(existsSync(join(cwd, ".maina/prompts/commit.md"))).toBe(true);
			expect(existsSync(join(cwd, ".maina/features/.gitkeep"))).toBe(true);
			expect(existsSync(join(cwd, ".maina/cache"))).toBe(true);
			expect(existsSync(join(cwd, ".maina/config.yml"))).toBe(true);
			expect(existsSync(join(cwd, ".maina/constitution.md"))).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("second call produces a byte-identical tree (idempotent)", async () => {
		const cwd = tmpRepo("scaffold-idempotent");
		try {
			const first = await scaffold({ cwd, withPrompts: true });
			expect(first.ok).toBe(true);
			const before = snapshotTree(join(cwd, ".maina"));

			const second = await scaffold({ cwd, withPrompts: true });
			expect(second.ok).toBe(true);
			const after = snapshotTree(join(cwd, ".maina"));

			expect(after).toEqual(before);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("does not overwrite user-customised files on re-run", async () => {
		const cwd = tmpRepo("scaffold-preserve");
		try {
			await scaffold({ cwd, withPrompts: true });
			// User edits commit.md with their own content.
			const commitPath = join(cwd, ".maina/prompts/commit.md");
			writeFileSync(commitPath, "# My own commit prompt\n", "utf-8");

			const second = await scaffold({ cwd, withPrompts: true });
			expect(second.ok).toBe(true);

			expect(readFileSync(commitPath, "utf-8")).toBe(
				"# My own commit prompt\n",
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("review.md and commit.md scaffolds are non-empty", async () => {
		const cwd = tmpRepo("scaffold-prompts");
		try {
			const res = await scaffold({ cwd, withPrompts: true });
			expect(res.ok).toBe(true);
			const review = readFileSync(
				join(cwd, ".maina/prompts/review.md"),
				"utf-8",
			);
			const commit = readFileSync(
				join(cwd, ".maina/prompts/commit.md"),
				"utf-8",
			);
			expect(review.trim().length).toBeGreaterThan(40);
			expect(commit.trim().length).toBeGreaterThan(40);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("returns a report with created + skipped lists", async () => {
		const cwd = tmpRepo("scaffold-report");
		try {
			const first = await scaffold({ cwd, withPrompts: true });
			expect(first.ok).toBe(true);
			if (!first.ok) return;
			expect(first.value.created.length).toBeGreaterThan(0);
			expect(first.value.skipped.length).toBe(0);

			const second = await scaffold({ cwd, withPrompts: true });
			expect(second.ok).toBe(true);
			if (!second.ok) return;
			// Second call: everything exists, everything skipped.
			expect(second.value.created.length).toBe(0);
			expect(second.value.skipped.length).toBeGreaterThan(0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("withPrompts: false does not write prompts/", async () => {
		const cwd = tmpRepo("scaffold-no-prompts");
		try {
			const res = await scaffold({ cwd, withPrompts: false });
			expect(res.ok).toBe(true);
			expect(existsSync(join(cwd, ".maina/prompts/review.md"))).toBe(false);
			expect(existsSync(join(cwd, ".maina/prompts/commit.md"))).toBe(false);
			// Other items still written.
			expect(existsSync(join(cwd, ".maina/config.yml"))).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("withConstitutionStub: false skips the constitution stub so callers can write tailored content", async () => {
		const cwd = tmpRepo("scaffold-no-const");
		try {
			const res = await scaffold({ cwd, withConstitutionStub: false });
			expect(res.ok).toBe(true);
			expect(existsSync(join(cwd, ".maina/constitution.md"))).toBe(false);
			// Other items still written.
			expect(existsSync(join(cwd, ".maina/config.yml"))).toBe(true);
			expect(existsSync(join(cwd, ".maina/prompts/review.md"))).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
