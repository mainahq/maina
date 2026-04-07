import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEmptyState, saveState } from "../state";

// ── Import under test ──────────────────────────────────────────────────────

const { onPostCommit } = await import("../hooks");

// ── Test Helpers ────────────────────────────────────────────────────────────

let tmpDir: string;

function createTmpDir(): string {
	const dir = join(
		import.meta.dir,
		`tmp-wiki-hooks-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Set up a minimal wiki directory with state file for testing.
 */
function setupWikiDir(root: string): string {
	const mainaDir = join(root, ".maina");
	const wikiDir = join(mainaDir, "wiki");
	mkdirSync(join(wikiDir, "modules"), { recursive: true });
	mkdirSync(join(wikiDir, "entities"), { recursive: true });
	mkdirSync(join(wikiDir, "features"), { recursive: true });
	mkdirSync(join(wikiDir, "decisions"), { recursive: true });
	mkdirSync(join(wikiDir, "architecture"), { recursive: true });
	mkdirSync(join(wikiDir, "raw"), { recursive: true });

	// Create state file (marks wiki as initialized)
	const state = createEmptyState();
	state.lastFullCompile = new Date().toISOString();
	saveState(wikiDir, state);

	return mainaDir;
}

/**
 * Create a minimal source file so the compiler has something to work with.
 */
function createSampleSource(root: string): void {
	const srcDir = join(root, "packages", "core", "src");
	mkdirSync(srcDir, { recursive: true });
	writeFileSync(
		join(srcDir, "index.ts"),
		"export function hello(): string { return 'hello'; }\n",
	);
}

beforeEach(() => {
	tmpDir = createTmpDir();
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Wiki Post-Commit Hook", () => {
	it("triggers incremental compile when wiki is initialized", async () => {
		createSampleSource(tmpDir);
		const mainaDir = setupWikiDir(tmpDir);

		// Should complete without throwing
		await onPostCommit(mainaDir, tmpDir);

		// Verify it ran by checking state was updated
		const { loadState } = await import("../state");
		const wikiDir = join(mainaDir, "wiki");
		const state = loadState(wikiDir);
		expect(state).not.toBeNull();
		// The compilation should have updated lastIncrementalCompile
		expect(state?.lastIncrementalCompile).toBeTruthy();
	});

	it("skips when wiki directory does not exist", async () => {
		const mainaDir = join(tmpDir, ".maina");
		mkdirSync(mainaDir, { recursive: true });
		// No wiki directory — should skip silently

		await onPostCommit(mainaDir, tmpDir);

		// Should complete without error — nothing to assert except no throw
		expect(true).toBe(true);
	});

	it("skips when wiki not initialized (no .state.json)", async () => {
		const mainaDir = join(tmpDir, ".maina");
		const wikiDir = join(mainaDir, "wiki");
		mkdirSync(wikiDir, { recursive: true });
		// Wiki directory exists but no .state.json

		await onPostCommit(mainaDir, tmpDir);

		// Should complete without error
		expect(true).toBe(true);
	});

	it("swallows errors gracefully", async () => {
		// Pass a completely invalid directory to trigger internal errors
		const bogusDir = join(tmpDir, "nonexistent", ".maina");

		// Should NOT throw — errors are swallowed
		await onPostCommit(bogusDir, tmpDir);

		expect(true).toBe(true);
	});
});
