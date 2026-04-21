/**
 * End-to-end fixture for Wave 3 acceptance:
 *
 * - Throwaway repo with a pre-existing `.claude/settings.json` that has an
 *   unrelated MCP entry.
 * - After `setupAction` runs, the file must contain BOTH the user's entry
 *   and the maina entry — byte-for-byte preservation (modulo formatter).
 *
 * The wizard has many moving parts (AI resolution, verify, wiki). We stub
 * every heavy dependency so the test is fast and deterministic, exercising
 * only the IDE-wiring path.
 */

import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	SetupActionDeps,
	SetupActionOptions,
	SpinnerLike,
} from "../setup";
import { setupAction } from "../setup";

const NOOP_LOG: SetupActionDeps["log"] = {
	info: () => {},
	error: () => {},
	warning: () => {},
	success: () => {},
	message: () => {},
	step: () => {},
};

const NOOP_SPINNER = (): SpinnerLike => ({ start: () => {}, stop: () => {} });

function initGitRepo(cwd: string): void {
	// Pretend this is a git repo by just creating .git/. setupAction's
	// default `isGitRepo` walks the filesystem, but we override it anyway.
	mkdirSync(join(cwd, ".git"), { recursive: true });
}

describe("setupAction IDE-wiring e2e fixture", () => {
	test("preserves existing .claude/settings.json MCP entries while adding maina", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "maina-setup-e2e-"));
		try {
			initGitRepo(cwd);

			// Seed a `.claude/settings.json` with an unrelated MCP entry. We
			// also stash an unrelated top-level key to confirm it's preserved.
			const settingsPath = join(cwd, ".claude", "settings.json");
			mkdirSync(join(cwd, ".claude"), { recursive: true });
			const userEntry = {
				command: "bunx",
				args: ["@modelcontextprotocol/server-memory"],
			};
			writeFileSync(
				settingsPath,
				JSON.stringify(
					{
						theme: "dark",
						mcpServers: {
							memory: userEntry,
						},
					},
					null,
					2,
				),
				"utf-8",
			);

			// Stub deps: every expensive thing is replaced with a minimal fake.
			const deps: SetupActionDeps = {
				intro: () => {},
				outro: () => {},
				log: NOOP_LOG,
				spinner: NOOP_SPINNER,
				isGitRepo: () => true,
				isDirty: async () => false,
				resolveAI: async () =>
					({
						source: "degraded",
						text: "# Project Constitution\n\nStub.\n",
						metadata: {
							source: "degraded",
							attemptedSources: ["degraded"],
							durationMs: 0,
						},
						// biome-ignore lint/suspicious/noExplicitAny: minimal stub
					}) as any,
				assembleStack: async () =>
					({
						ok: true,
						value: {
							languages: ["typescript"],
							frameworks: [],
							packageManager: "bun",
							buildTool: null,
							linters: ["biome"],
							testRunners: ["bun:test"],
							cicd: [],
							repoSize: { files: 5, bytes: 10 },
							isEmpty: false,
							isLarge: false,
						},
						// biome-ignore lint/suspicious/noExplicitAny: minimal stub
					}) as any,
				writeAgentFiles: async () => ({
					ok: true,
					value: { written: [], warnings: [] },
				}),
				runVerify: async () => ({ findings: [], clean: true }),
				confirm: async () => true,
				seedWiki: async () => ({
					ran: false,
					pages: null,
					backgrounded: false,
					skipped: "empty-repo" as const,
					error: null,
				}),
			};

			const options: SetupActionOptions = {
				cwd,
				yes: true,
				ci: true,
				json: true,
				telemetry: false,
				deps,
				sendTelemetry: async () => ({ sent: false, error: null }),
			};

			const result = await setupAction(options);
			expect(result.bailed).toBe(false);
			expect(result.constitutionWritten).toBe(true);

			// Verify merge outcome.
			const parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
				theme?: string;
				mcpServers: Record<string, { command: string; args: string[] }>;
			};
			expect(parsed.theme).toBe("dark");
			expect(parsed.mcpServers.memory).toEqual(userEntry);
			const mainaEntry = parsed.mcpServers.maina;
			expect(mainaEntry).toBeDefined();
			if (!mainaEntry) return;
			// The resolved command depends on machine state — could be bunx,
			// npx, or a direct maina binary path. All that matters here is
			// that an entry exists with a non-empty command.
			expect(typeof mainaEntry.command).toBe("string");
			expect(mainaEntry.command.length).toBeGreaterThan(0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("preserves existing .cursor/mcp.json entries", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "maina-setup-cursor-e2e-"));
		try {
			initGitRepo(cwd);
			const cursorPath = join(cwd, ".cursor", "mcp.json");
			mkdirSync(join(cwd, ".cursor"), { recursive: true });
			const userEntry = { command: "node", args: ["/tmp/custom.js"] };
			writeFileSync(
				cursorPath,
				JSON.stringify({ mcpServers: { custom: userEntry } }, null, 2),
				"utf-8",
			);

			const deps: SetupActionDeps = {
				intro: () => {},
				outro: () => {},
				log: NOOP_LOG,
				spinner: NOOP_SPINNER,
				isGitRepo: () => true,
				isDirty: async () => false,
				resolveAI: async () =>
					({
						source: "degraded",
						text: "# Stub\n",
						metadata: {
							source: "degraded",
							attemptedSources: ["degraded"],
							durationMs: 0,
						},
						// biome-ignore lint/suspicious/noExplicitAny: minimal stub
					}) as any,
				assembleStack: async () =>
					({
						ok: true,
						value: {
							languages: ["typescript"],
							frameworks: [],
							packageManager: "bun",
							buildTool: null,
							linters: [],
							testRunners: [],
							cicd: [],
							repoSize: { files: 0, bytes: 0 },
							isEmpty: false,
							isLarge: false,
						},
						// biome-ignore lint/suspicious/noExplicitAny: minimal stub
					}) as any,
				writeAgentFiles: async () => ({
					ok: true,
					value: { written: [], warnings: [] },
				}),
				runVerify: async () => ({ findings: [], clean: true }),
				confirm: async () => true,
				seedWiki: async () => ({
					ran: false,
					pages: null,
					backgrounded: false,
					skipped: "empty-repo" as const,
					error: null,
				}),
			};

			const options: SetupActionOptions = {
				cwd,
				yes: true,
				ci: true,
				json: true,
				telemetry: false,
				deps,
				sendTelemetry: async () => ({ sent: false, error: null }),
			};

			const result = await setupAction(options);
			expect(result.bailed).toBe(false);

			const parsed = JSON.parse(readFileSync(cursorPath, "utf-8")) as {
				mcpServers: Record<string, { command: string; args: string[] }>;
			};
			expect(parsed.mcpServers.custom).toEqual(userEntry);
			expect(parsed.mcpServers.maina).toBeDefined();
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("materialises .maina/skills/<name>/SKILL.md after setup", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "maina-setup-skills-e2e-"));
		try {
			initGitRepo(cwd);
			const deps: SetupActionDeps = {
				intro: () => {},
				outro: () => {},
				log: NOOP_LOG,
				spinner: NOOP_SPINNER,
				isGitRepo: () => true,
				isDirty: async () => false,
				resolveAI: async () =>
					({
						source: "degraded",
						text: "# Stub\n",
						metadata: {
							source: "degraded",
							attemptedSources: ["degraded"],
							durationMs: 0,
						},
						// biome-ignore lint/suspicious/noExplicitAny: minimal stub
					}) as any,
				assembleStack: async () =>
					({
						ok: true,
						value: {
							languages: ["typescript"],
							frameworks: [],
							packageManager: "bun",
							buildTool: null,
							linters: [],
							testRunners: [],
							cicd: [],
							repoSize: { files: 0, bytes: 0 },
							isEmpty: false,
							isLarge: false,
						},
						// biome-ignore lint/suspicious/noExplicitAny: minimal stub
					}) as any,
				writeAgentFiles: async () => ({
					ok: true,
					value: { written: [], warnings: [] },
				}),
				runVerify: async () => ({ findings: [], clean: true }),
				confirm: async () => true,
				seedWiki: async () => ({
					ran: false,
					pages: null,
					backgrounded: false,
					skipped: "empty-repo" as const,
					error: null,
				}),
			};

			const options: SetupActionOptions = {
				cwd,
				yes: true,
				ci: true,
				json: true,
				telemetry: false,
				deps,
				sendTelemetry: async () => ({ sent: false, error: null }),
			};

			const result = await setupAction(options);
			expect(result.bailed).toBe(false);

			// At least one SKILL.md should land in .maina/skills/<name>/.
			expect(existsSync(join(cwd, ".maina/skills"))).toBe(true);
			// Spot-check two known skill names.
			expect(existsSync(join(cwd, ".maina/skills/tdd/SKILL.md"))).toBe(true);
			expect(existsSync(join(cwd, ".maina/skills/code-review/SKILL.md"))).toBe(
				true,
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("shared scaffold materialises `.maina/prompts/{review,commit}.md`", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "maina-setup-prompts-e2e-"));
		try {
			initGitRepo(cwd);
			const deps: SetupActionDeps = {
				intro: () => {},
				outro: () => {},
				log: NOOP_LOG,
				spinner: NOOP_SPINNER,
				isGitRepo: () => true,
				isDirty: async () => false,
				resolveAI: async () =>
					({
						source: "degraded",
						text: "# Stub\n",
						metadata: {
							source: "degraded",
							attemptedSources: ["degraded"],
							durationMs: 0,
						},
						// biome-ignore lint/suspicious/noExplicitAny: minimal stub
					}) as any,
				assembleStack: async () =>
					({
						ok: true,
						value: {
							languages: ["typescript"],
							frameworks: [],
							packageManager: "bun",
							buildTool: null,
							linters: [],
							testRunners: [],
							cicd: [],
							repoSize: { files: 0, bytes: 0 },
							isEmpty: false,
							isLarge: false,
						},
						// biome-ignore lint/suspicious/noExplicitAny: minimal stub
					}) as any,
				writeAgentFiles: async () => ({
					ok: true,
					value: { written: [], warnings: [] },
				}),
				runVerify: async () => ({ findings: [], clean: true }),
				confirm: async () => true,
				seedWiki: async () => ({
					ran: false,
					pages: null,
					backgrounded: false,
					skipped: "empty-repo" as const,
					error: null,
				}),
			};

			const options: SetupActionOptions = {
				cwd,
				yes: true,
				ci: true,
				json: true,
				telemetry: false,
				deps,
				sendTelemetry: async () => ({ sent: false, error: null }),
			};

			await setupAction(options);

			expect(existsSync(join(cwd, ".maina/prompts/review.md"))).toBe(true);
			expect(existsSync(join(cwd, ".maina/prompts/commit.md"))).toBe(true);
			expect(existsSync(join(cwd, ".maina/config.yml"))).toBe(true);
			expect(existsSync(join(cwd, ".maina/features/.gitkeep"))).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
