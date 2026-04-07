import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEmptyState,
	getChangedFiles,
	hashContent,
	loadState,
	saveState,
} from "../state";
import type { WikiState } from "../types";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`wiki-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(join(tmpDir, "wiki"), { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("Wiki State", () => {
	describe("createEmptyState", () => {
		it("should create state with empty hashes and no timestamps", () => {
			const state = createEmptyState();
			expect(Object.keys(state.fileHashes)).toHaveLength(0);
			expect(Object.keys(state.articleHashes)).toHaveLength(0);
			expect(state.lastFullCompile).toBe("");
			expect(state.lastIncrementalCompile).toBe("");
			expect(state.compilationPromptHash).toBe("");
		});
	});

	describe("hashContent", () => {
		it("should produce consistent SHA-256 hashes", () => {
			const hash1 = hashContent("hello world");
			const hash2 = hashContent("hello world");
			expect(hash1).toBe(hash2);
		});

		it("should produce different hashes for different content", () => {
			const hash1 = hashContent("hello");
			const hash2 = hashContent("world");
			expect(hash1).not.toBe(hash2);
		});

		it("should handle empty string", () => {
			const hash = hashContent("");
			expect(hash).toBeTruthy();
			expect(typeof hash).toBe("string");
		});

		it("should produce hex-encoded hashes", () => {
			const hash = hashContent("test");
			expect(hash).toMatch(/^[a-f0-9]{64}$/);
		});
	});

	describe("saveState / loadState round-trip", () => {
		it("should save and load state correctly", () => {
			const wikiDir = join(tmpDir, "wiki");
			const state: WikiState = {
				fileHashes: { "src/a.ts": "abc", "src/b.ts": "def" },
				articleHashes: { "modules/auth.md": "ghi" },
				lastFullCompile: "2026-04-07T00:00:00.000Z",
				lastIncrementalCompile: "2026-04-07T12:00:00.000Z",
				compilationPromptHash: "prompt_v1",
			};

			saveState(wikiDir, state);
			const loaded = loadState(wikiDir);

			expect(loaded).not.toBeNull();
			expect(loaded?.fileHashes["src/a.ts"]).toBe("abc");
			expect(loaded?.articleHashes["modules/auth.md"]).toBe("ghi");
			expect(loaded?.lastFullCompile).toBe("2026-04-07T00:00:00.000Z");
			expect(loaded?.compilationPromptHash).toBe("prompt_v1");
		});

		it("should return null when no state file exists", () => {
			const wikiDir = join(tmpDir, "wiki");
			const loaded = loadState(wikiDir);
			expect(loaded).toBeNull();
		});

		it("should handle corrupted state file gracefully", () => {
			const wikiDir = join(tmpDir, "wiki");
			writeFileSync(join(wikiDir, ".state.json"), "not valid json");
			const loaded = loadState(wikiDir);
			expect(loaded).toBeNull();
		});

		it("should overwrite previous state on save", () => {
			const wikiDir = join(tmpDir, "wiki");
			const state1: WikiState = {
				fileHashes: { "a.ts": "old" },
				articleHashes: {},
				lastFullCompile: "old",
				lastIncrementalCompile: "",
				compilationPromptHash: "",
			};
			saveState(wikiDir, state1);

			const state2: WikiState = {
				fileHashes: { "a.ts": "new", "b.ts": "added" },
				articleHashes: {},
				lastFullCompile: "new",
				lastIncrementalCompile: "",
				compilationPromptHash: "",
			};
			saveState(wikiDir, state2);

			const loaded = loadState(wikiDir);
			expect(loaded?.fileHashes["a.ts"]).toBe("new");
			expect(loaded?.fileHashes["b.ts"]).toBe("added");
		});
	});

	describe("getChangedFiles", () => {
		it("should detect new files not in previous state", () => {
			const previousHashes: Record<string, string> = { "a.ts": "hash1" };
			const currentHashes: Record<string, string> = {
				"a.ts": "hash1",
				"b.ts": "hash2",
			};

			const changed = getChangedFiles(previousHashes, currentHashes);
			expect(changed).toContain("b.ts");
			expect(changed).not.toContain("a.ts");
		});

		it("should detect modified files with changed hashes", () => {
			const previousHashes: Record<string, string> = { "a.ts": "old" };
			const currentHashes: Record<string, string> = { "a.ts": "new" };

			const changed = getChangedFiles(previousHashes, currentHashes);
			expect(changed).toContain("a.ts");
		});

		it("should detect deleted files", () => {
			const previousHashes: Record<string, string> = {
				"a.ts": "hash1",
				"b.ts": "hash2",
			};
			const currentHashes: Record<string, string> = { "a.ts": "hash1" };

			const changed = getChangedFiles(previousHashes, currentHashes);
			expect(changed).toContain("b.ts");
		});

		it("should return empty array when nothing changed", () => {
			const hashes: Record<string, string> = { "a.ts": "hash1" };
			const changed = getChangedFiles(hashes, { ...hashes });
			expect(changed).toHaveLength(0);
		});

		it("should handle empty previous state (first compilation)", () => {
			const changed = getChangedFiles({}, { "a.ts": "h1", "b.ts": "h2" });
			expect(changed).toHaveLength(2);
		});
	});
});
