import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TEMPLATES_DIR = join(import.meta.dir, "..", "templates");
const AGENTS_DIR = join(import.meta.dir, "..", "agents");

/**
 * Single source of truth for the rule-C2 banned-phrase set. Keep these in
 * lock-step with the BAD examples documented in the prompt + template files
 * — if a prompt teaches a phrase as banned, the regex set must catch it.
 */
const BANNED_C2_PHRASES = [
	// "0 findings", "0 issue(s)", "0 problem(s)", "0 errors", etc.
	/\b0\s+(?:findings?|issues?|problems?|errors?)(?:\(s\))?\b/i,
	// "no findings/issues/problems/errors", with or without "found"/"detected"
	/\bno\s+(?:issues?|errors?|problems?|findings?)(?:\s+(?:found|detected))?\b/i,
	// "no security findings/concerns/issues"
	/\bno\s+security\s+(?:findings?|concerns?|issues?)\b/i,
];

/**
 * Drop teaching spans where prompts intentionally quote banned phrases.
 * A span starts at any line that contains a BAD marker
 * (`BAD`, `**BAD**`, or `BAD (descriptor):`) and runs until the next blank
 * line so wrapped-quote continuations are also stripped. No fence handling
 * — a single BAD marker controls one paragraph.
 */
function stripTeachingLines(content: string): string {
	const lines = content.split("\n");
	const out: string[] = [];
	let inSpan = false;
	for (const line of lines) {
		if (/\*{0,2}BAD(?:\s*\(.*?\))?\s*[:*]/i.test(line)) {
			inSpan = true;
			continue;
		}
		if (inSpan) {
			if (line.trim().length === 0) {
				inSpan = false;
				out.push(line);
			}
			continue;
		}
		out.push(line);
	}
	return out.join("\n");
}

function listMd(dir: string): string[] {
	return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md");
}

describe("prompt templates", () => {
	const files = listMd(TEMPLATES_DIR);

	test("ships exactly the three locked templates", () => {
		expect(files.sort()).toEqual([
			"plan-template.md",
			"spec-template.md",
			"tasks-template.md",
		]);
	});

	test.each(files)("%s — non-empty + reasonable size", (file) => {
		const content = readFileSync(join(TEMPLATES_DIR, file), "utf-8");
		expect(content.length).toBeGreaterThan(500);
		expect(content.length).toBeLessThan(20_000);
	});

	test.each(
		files,
	)("%s — no banned C2 phrases (outside teaching examples)", (file) => {
		const raw = readFileSync(join(TEMPLATES_DIR, file), "utf-8");
		const content = stripTeachingLines(raw);
		for (const banned of BANNED_C2_PHRASES) {
			expect(content).not.toMatch(banned);
		}
	});

	test.each(files)("%s — contains a NEEDS CLARIFICATION example", (file) => {
		const content = readFileSync(join(TEMPLATES_DIR, file), "utf-8");
		// Spec + plan must teach the marker; tasks template doesn't need to
		// since open questions live earlier in the pipeline.
		if (file === "tasks-template.md") return;
		expect(content).toMatch(/\[NEEDS CLARIFICATION:/);
	});
});

describe("agent prompts", () => {
	const files = listMd(AGENTS_DIR);

	test("ships the locked v0 agent set", () => {
		expect(files.sort()).toEqual(["debug.md", "review.md", "router.md"]);
	});

	test.each(files)("%s — has Input + Persona-or-Process structure", (file) => {
		const content = readFileSync(join(AGENTS_DIR, file), "utf-8");
		expect(content).toMatch(/## Input/);
		// Every agent prompt must explain *who* the model is or *how* it
		// answers. Persona, Process, or Output structure are the three
		// patterns we ship; at least one must be present.
		expect(content).toMatch(/## (?:Persona|Process|Output)/);
	});

	test.each(
		files,
	)("%s — no banned C2 phrases (outside teaching examples)", (file) => {
		const raw = readFileSync(join(AGENTS_DIR, file), "utf-8");
		const content = stripTeachingLines(raw);
		for (const banned of BANNED_C2_PHRASES) {
			expect(content).not.toMatch(banned);
		}
	});

	test.each(files)("%s — uses verification framing", (file) => {
		const content = readFileSync(join(AGENTS_DIR, file), "utf-8");
		// The agent prompts must use Maina's verification language — the
		// router classifies *into* verify agents, the review/debug prompts
		// explain *why* a check holds or doesn't.
		expect(content).toMatch(/\b(?:verify|verification|receipt|merge)\b/i);
	});
});
