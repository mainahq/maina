import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashContent } from "../../cache/keys";
import { getFeedbackDb } from "../../db/index";
import { buildSystemPrompt, getPromptStats, recordOutcome } from "../engine";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-engine-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		const { rmSync } = require("node:fs");
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("buildSystemPrompt", () => {
	test("includes constitution content when present", async () => {
		const constitutionContent = "Always be concise.";
		writeFileSync(join(tmpDir, "constitution.md"), constitutionContent);

		// Use a user override with {{constitution}} to ensure test is independent
		// of which default template loadDefault returns
		const promptsDir = join(tmpDir, "prompts");
		mkdirSync(promptsDir, { recursive: true });
		writeFileSync(
			join(promptsDir, "commit.md"),
			"Task prompt.\n\n## Constitution\n{{constitution}}\n\n## Diff\n{{diff}}",
		);

		const result = await buildSystemPrompt("commit", tmpDir, {
			diff: "some diff",
		});

		expect(result.prompt).toContain(constitutionContent);
	});

	test("replaces template variables", async () => {
		// Use a user override with {{diff}} to ensure deterministic template
		const promptsDir = join(tmpDir, "prompts");
		mkdirSync(promptsDir, { recursive: true });
		writeFileSync(
			join(promptsDir, "commit.md"),
			"Generate commit for:\n{{diff}}",
		);

		const result = await buildSystemPrompt("commit", tmpDir, {
			diff: "my test diff content",
		});

		expect(result.prompt).toContain("my test diff content");
		expect(result.prompt).not.toContain("{{diff}}");
	});

	test("returns consistent hash for same content", async () => {
		// Use a user override so hash is deterministic regardless of default template
		const promptsDir = join(tmpDir, "prompts");
		mkdirSync(promptsDir, { recursive: true });
		writeFileSync(join(promptsDir, "commit.md"), "Stable prompt: {{diff}}");

		const context = { diff: "same diff" };

		const result1 = await buildSystemPrompt("commit", tmpDir, context);
		const result2 = await buildSystemPrompt("commit", tmpDir, context);

		expect(result1.hash).toBe(result2.hash);
		expect(result1.hash).toBe(hashContent(result1.prompt));
	});

	test("uses user override when available", async () => {
		const promptsDir = join(tmpDir, "prompts");
		mkdirSync(promptsDir, { recursive: true });
		const customPrompt = "Custom commit prompt: {{diff}}";
		writeFileSync(join(promptsDir, "commit.md"), customPrompt);

		const result = await buildSystemPrompt("commit", tmpDir, {
			diff: "override diff",
		});

		expect(result.prompt).toContain("Custom commit prompt:");
		expect(result.prompt).toContain("override diff");
	});
});

describe("recordOutcome", () => {
	test("writes to feedback database", async () => {
		const promptHash = "abc123hash";
		const outcome = {
			accepted: true,
			command: "git commit -m 'feat: add feature'",
			context: "some context",
		};

		recordOutcome(tmpDir, promptHash, outcome);

		// verify by reading back from db
		const dbResult = getFeedbackDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;

		const { db } = dbResult.value;
		const rows = db
			.query("SELECT * FROM feedback WHERE prompt_hash = ?")
			.all(promptHash) as Array<{
			id: string;
			prompt_hash: string;
			command: string;
			accepted: number;
			context: string;
			created_at: string;
		}>;

		expect(rows.length).toBe(1);
		const row = rows[0];
		expect(row).toBeDefined();
		expect(row?.prompt_hash).toBe(promptHash);
		expect(row?.command).toBe(outcome.command);
		expect(row?.accepted).toBe(1);
		expect(row?.context).toBe("some context");
		expect(row?.created_at).toBeTruthy();
	});

	test("handles rejected outcome", async () => {
		const promptHash = "rejected-hash";
		const outcome = {
			accepted: false,
			command: "git commit -m 'bad commit'",
		};

		recordOutcome(tmpDir, promptHash, outcome);

		const dbResult = getFeedbackDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;

		const { db } = dbResult.value;
		const rows = db
			.query("SELECT * FROM feedback WHERE prompt_hash = ?")
			.all(promptHash) as Array<{ accepted: number }>;

		expect(rows.length).toBe(1);
		expect(rows[0]?.accepted).toBe(0);
	});
});

describe("getPromptStats", () => {
	test("returns correct accept rates", async () => {
		// record some outcomes
		recordOutcome(tmpDir, "hash-A", { accepted: true, command: "cmd1" });
		recordOutcome(tmpDir, "hash-A", { accepted: true, command: "cmd2" });
		recordOutcome(tmpDir, "hash-A", { accepted: false, command: "cmd3" });
		recordOutcome(tmpDir, "hash-B", { accepted: false, command: "cmd4" });

		const stats = getPromptStats(tmpDir);

		const statA = stats.find((s) => s.promptHash === "hash-A");
		const statB = stats.find((s) => s.promptHash === "hash-B");

		expect(statA).toBeDefined();
		expect(statA?.totalUsage).toBe(3);
		// 2 accepted out of 3
		expect(statA?.acceptRate).toBeCloseTo(2 / 3, 5);

		expect(statB).toBeDefined();
		expect(statB?.totalUsage).toBe(1);
		expect(statB?.acceptRate).toBe(0);
	});

	test("returns empty array when no feedback recorded", async () => {
		const stats = getPromptStats(tmpDir);
		expect(stats).toEqual([]);
	});
});
