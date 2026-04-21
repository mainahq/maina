/**
 * Ensures every generated constitution — including the offline degraded
 * fallback — contains the `## Maina Workflow` and `## File Layout` sections
 * verbatim. This is the single source of truth for onboarding-60s gap G7.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StackContext } from "../context";
import { resolveSetupAI } from "../resolve-ai";

const STACK: StackContext = {
	languages: ["typescript"],
	frameworks: [],
	packageManager: "bun",
	buildTool: "bunup",
	linters: ["biome"],
	testRunners: ["bun:test"],
	cicd: ["github-actions"],
	repoSize: { files: 10, bytes: 1234 },
	isEmpty: false,
	isLarge: false,
};

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-generic-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

const ENV_KEYS = [
	"MAINA_HOST_MODE",
	"CLAUDECODE",
	"CLAUDE_CODE_ENTRYPOINT",
	"CURSOR",
	"MAINA_API_KEY",
	"OPENROUTER_API_KEY",
	"ANTHROPIC_API_KEY",
];

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	savedEnv = {};
	for (const k of ENV_KEYS) {
		savedEnv[k] = process.env[k];
		delete process.env[k];
	}
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		const v = savedEnv[k];
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe("offline generic constitution", () => {
	test("forced degraded path contains ## Maina Workflow section", async () => {
		const cwd = makeTmpDir();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: "tiny",
				fingerprint: "abcd",
				forceSource: "degraded",
			});
			expect(result.source).toBe("degraded");
			if (result.source !== "degraded") return;
			expect(result.text).toMatch(/^##\s+Maina Workflow\b/m);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("forced degraded path contains ## File Layout section", async () => {
		const cwd = makeTmpDir();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: "tiny",
				fingerprint: "abcd",
				forceSource: "degraded",
			});
			expect(result.source).toBe("degraded");
			if (result.source !== "degraded") return;
			expect(result.text).toMatch(/^##\s+File Layout\b/m);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("cloud/byok/host all failing → degraded constitution still includes both sections", async () => {
		const cwd = makeTmpDir();
		try {
			const result = await resolveSetupAI({
				cwd,
				stack: STACK,
				repoSummary: "tiny",
				fingerprint: "abcd",
				fetchImpl: (async () => {
					throw new Error("offline");
				}) as unknown as typeof fetch,
			});
			expect(result.source).toBe("degraded");
			if (result.source !== "degraded") return;
			expect(result.text).toMatch(/^##\s+Maina Workflow\b/m);
			expect(result.text).toMatch(/^##\s+File Layout\b/m);
			// Detected languages surface.
			expect(result.text.toLowerCase()).toContain("typescript");
			// Workflow arrow is present verbatim — no paraphrasing.
			expect(result.text).toContain("brainstorm → ticket → plan");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("empty stack → both sections still present", async () => {
		const cwd = makeTmpDir();
		try {
			const emptyStack: StackContext = {
				languages: [],
				frameworks: [],
				packageManager: "unknown",
				buildTool: null,
				linters: [],
				testRunners: [],
				cicd: [],
				repoSize: { files: 0, bytes: 0 },
				isEmpty: true,
				isLarge: false,
			};
			const result = await resolveSetupAI({
				cwd,
				stack: emptyStack,
				repoSummary: "",
				fingerprint: "abcd",
				forceSource: "degraded",
			});
			if (result.source !== "degraded") throw new Error("expected degraded");
			expect(result.text).toMatch(/^##\s+Maina Workflow\b/m);
			expect(result.text).toMatch(/^##\s+File Layout\b/m);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
