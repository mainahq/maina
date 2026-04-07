import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateTokens } from "../budget";
import { assembleWikiText, loadWikiContext } from "../wiki";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
	const dir = join(
		tmpdir(),
		`maina-wiki-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writeWikiFile(
	wikiDir: string,
	relPath: string,
	content: string,
): void {
	const fullPath = join(wikiDir, relPath);
	const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
	mkdirSync(dir, { recursive: true });
	writeFileSync(fullPath, content, "utf8");
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("loadWikiContext", () => {
	let wikiDir: string;

	beforeEach(() => {
		wikiDir = makeTempDir();
	});

	afterEach(() => {
		try {
			rmSync(wikiDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	it("returns null when wiki directory does not exist", () => {
		const result = loadWikiContext({
			wikiDir: join(tmpdir(), "nonexistent-wiki-dir-xyz"),
		});
		expect(result).toBeNull();
	});

	it("returns null when wiki directory is empty", () => {
		// wikiDir exists but has no files
		const result = loadWikiContext({ wikiDir });
		expect(result).toBeNull();
	});

	it("loads index.md when wiki exists", () => {
		writeWikiFile(wikiDir, "index.md", "# Wiki Index\nOverview of articles.");

		const result = loadWikiContext({ wikiDir });
		expect(result).not.toBeNull();
		expect(result?.text).toContain("Wiki Index");
		expect(result?.text).toContain("Overview of articles");
	});

	it("loads decision articles for review command", () => {
		writeWikiFile(wikiDir, "index.md", "# Index");
		writeWikiFile(
			wikiDir,
			"decisions/adr-001.md",
			"# ADR-001: Use TypeScript\nWe chose TypeScript for type safety.",
		);
		writeWikiFile(
			wikiDir,
			"features/feature-auth.md",
			"# Auth Feature\nAuthentication implementation details.",
		);

		const result = loadWikiContext({ wikiDir, command: "review" });
		expect(result).not.toBeNull();
		expect(result?.text).toContain("ADR-001");
		// review loads decisions and modules, not features
		expect(result?.text).not.toContain("Auth Feature");
	});

	it("loads feature articles for commit command", () => {
		writeWikiFile(wikiDir, "index.md", "# Index");
		writeWikiFile(
			wikiDir,
			"features/feature-wiki.md",
			"# Wiki Feature\nWiki context layer details.",
		);
		writeWikiFile(
			wikiDir,
			"decisions/adr-001.md",
			"# ADR-001: TypeScript\nDecision content.",
		);

		const result = loadWikiContext({ wikiDir, command: "commit" });
		expect(result).not.toBeNull();
		expect(result?.text).toContain("Wiki Feature");
		// commit loads features and architecture, not decisions
		expect(result?.text).not.toContain("ADR-001");
	});

	it("loads all article types for explain command (exploration mode)", () => {
		writeWikiFile(wikiDir, "index.md", "# Index");
		writeWikiFile(
			wikiDir,
			"decisions/adr-001.md",
			"# ADR-001\nDecision content.",
		);
		writeWikiFile(
			wikiDir,
			"features/feature-auth.md",
			"# Auth Feature\nAuth details.",
		);
		writeWikiFile(
			wikiDir,
			"modules/context-engine.md",
			"# Context Engine\nEngine docs.",
		);
		writeWikiFile(
			wikiDir,
			"architecture/overview.md",
			"# Architecture Overview\nSystem design.",
		);

		const result = loadWikiContext({ wikiDir, command: "explain" });
		expect(result).not.toBeNull();
		expect(result?.text).toContain("ADR-001");
		expect(result?.text).toContain("Auth Feature");
		expect(result?.text).toContain("Context Engine");
		expect(result?.text).toContain("Architecture Overview");
	});

	it("loads decision articles for design command (conflict detection)", () => {
		writeWikiFile(wikiDir, "index.md", "# Index");
		writeWikiFile(
			wikiDir,
			"decisions/adr-001.md",
			"# ADR-001\nDecision content.",
		);
		writeWikiFile(
			wikiDir,
			"features/feature-auth.md",
			"# Auth Feature\nShould not be loaded.",
		);

		const result = loadWikiContext({ wikiDir, command: "design" });
		expect(result).not.toBeNull();
		expect(result?.text).toContain("ADR-001");
		expect(result?.text).not.toContain("Auth Feature");
	});

	it("respects token budget (returns content within reasonable bounds)", () => {
		writeWikiFile(wikiDir, "index.md", "# Index");
		// Create several articles
		for (let i = 0; i < 10; i++) {
			writeWikiFile(
				wikiDir,
				`decisions/adr-${String(i).padStart(3, "0")}.md`,
				`# ADR-${i}\n${"Content line. ".repeat(100)}`,
			);
		}

		const result = loadWikiContext({ wikiDir, command: "review" });
		expect(result).not.toBeNull();
		expect(result?.tokens).toBeGreaterThan(0);
		// Tokens should match calculateTokens of the text
		expect(result?.tokens).toBe(calculateTokens(result?.text ?? ""));
	});

	it("returns valid LayerContent with correct name and priority", () => {
		writeWikiFile(wikiDir, "index.md", "# Wiki Index");

		const result = loadWikiContext({ wikiDir });
		expect(result).not.toBeNull();
		expect(result?.name).toBe("wiki");
		expect(result?.priority).toBe(4);
		expect(typeof result?.text).toBe("string");
		expect(typeof result?.tokens).toBe("number");
	});

	it("handles empty wiki directory gracefully", () => {
		// Create a subdirectory but no files
		mkdirSync(join(wikiDir, "decisions"), { recursive: true });

		const result = loadWikiContext({ wikiDir });
		// Directory has an entry (subdirectory) but no actual content
		expect(result).toBeNull();
	});

	it("boosts articles relevant to working files", () => {
		writeWikiFile(wikiDir, "index.md", "# Index");
		writeWikiFile(
			wikiDir,
			"modules/context-engine.md",
			"# Context Engine\nRelevant to working files.",
		);
		writeWikiFile(
			wikiDir,
			"modules/git-ops.md",
			"# Git Operations\nNot relevant to working files.",
		);

		const result = loadWikiContext({
			wikiDir,
			workingFiles: ["packages/core/src/context/engine.ts"],
			command: "review",
		});
		expect(result).not.toBeNull();
		// Both should be loaded since both are modules and command is review
		expect(result?.text).toContain("Context Engine");
	});

	it("returns null when wiki dir has only empty subdirectories", () => {
		mkdirSync(join(wikiDir, "decisions"), { recursive: true });
		mkdirSync(join(wikiDir, "modules"), { recursive: true });

		const result = loadWikiContext({ wikiDir });
		expect(result).toBeNull();
	});

	it("includes index content in output even without other articles", () => {
		writeWikiFile(wikiDir, "index.md", "# Project Wiki\nThis is the index.");

		const result = loadWikiContext({ wikiDir });
		expect(result).not.toBeNull();
		expect(result?.text).toContain("## Wiki Knowledge (Layer 5)");
		expect(result?.text).toContain("### Index");
		expect(result?.text).toContain("Project Wiki");
	});

	it("formats articles with wiki/ path prefix", () => {
		writeWikiFile(wikiDir, "index.md", "# Index");
		writeWikiFile(
			wikiDir,
			"decisions/adr-001.md",
			"# ADR-001: Use Bun\nBun is faster.",
		);

		const result = loadWikiContext({ wikiDir, command: "review" });
		expect(result).not.toBeNull();
		expect(result?.text).toContain("wiki/decisions/adr-001.md");
	});

	it("loads all articles when no command is specified (default)", () => {
		writeWikiFile(wikiDir, "index.md", "# Index");
		writeWikiFile(
			wikiDir,
			"decisions/adr-001.md",
			"# Decision\nDecision content.",
		);
		writeWikiFile(
			wikiDir,
			"features/feature.md",
			"# Feature\nFeature content.",
		);

		const result = loadWikiContext({ wikiDir });
		expect(result).not.toBeNull();
		expect(result?.text).toContain("Decision");
		expect(result?.text).toContain("Feature");
	});
});

describe("assembleWikiText", () => {
	it("formats with correct headers", () => {
		const text = assembleWikiText("# Index content", [
			{
				path: "decisions/adr-001.md",
				title: "ADR-001",
				content: "Decision content.",
				category: "decision",
				score: 0.9,
			},
		]);

		expect(text).toContain("## Wiki Knowledge (Layer 5)");
		expect(text).toContain("### Index");
		expect(text).toContain("# Index content");
		expect(text).toContain("### Relevant Articles");
		expect(text).toContain("#### ADR-001 (wiki/decisions/adr-001.md)");
		expect(text).toContain("Decision content.");
		expect(text).toContain("---");
	});

	it("handles empty index", () => {
		const text = assembleWikiText("", [
			{
				path: "decisions/adr-001.md",
				title: "ADR-001",
				content: "Content.",
				category: "decision",
				score: 0.9,
			},
		]);

		expect(text).toContain("## Wiki Knowledge (Layer 5)");
		expect(text).not.toContain("### Index");
		expect(text).toContain("### Relevant Articles");
	});

	it("handles empty articles", () => {
		const text = assembleWikiText("# Index", []);

		expect(text).toContain("## Wiki Knowledge (Layer 5)");
		expect(text).toContain("### Index");
		expect(text).not.toContain("### Relevant Articles");
	});
});
