import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DoctorActionResult } from "../doctor";
import {
	buildClaudeSettingsJson,
	detectEnvironment,
	ensureClaudeSettings,
	type SetupActionDeps,
	setupAction,
} from "../setup";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeGitRepo(dir: string): void {
	mkdirSync(join(dir, ".git"), { recursive: true });
}

function makeDeps(overrides?: Partial<SetupActionDeps>): SetupActionDeps {
	return {
		intro: () => {},
		outro: () => {},
		log: {
			info: () => {},
			error: () => {},
			warning: () => {},
			success: () => {},
			message: () => {},
			step: () => {},
		},
		spinner: () => ({
			start: () => {},
			stop: () => {},
		}),
		detectEnv: () => "generic",
		confirmWiki: async () => false,
		runInit: async () => true,
		runDoctor: async () => makeDoctorResult(),
		...overrides,
	};
}

function makeDoctorResult(): DoctorActionResult {
	return {
		version: "1.0.0",
		tools: [
			{ name: "biome", command: "biome", version: "1.9.4", available: true },
			{ name: "semgrep", command: "semgrep", version: null, available: false },
		],
		engines: { context: "ready", prompt: "ready", verify: "ready" },
		cacheStats: null,
		aiStatus: {
			apiKey: false,
			hostMode: false,
			feedbackTotal: 0,
			feedbackAcceptRate: 0,
			cacheEntries: 0,
			cacheHitRate: 0,
		},
		wikiHealth: {
			initialized: false,
			totalArticles: 0,
			staleCount: 0,
			coveragePercent: 0,
			lastCompile: "never",
		},
		mcpHealth: {
			mcpJson: false,
			claudeSettings: false,
			serverCommand: "not configured",
			toolCount: 0,
		},
	};
}

// ── Tests ───────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = makeTmpDir();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectEnvironment", () => {
	test("detects Claude Code from CLAUDE_CODE env var", () => {
		const original = process.env.CLAUDE_CODE;
		process.env.CLAUDE_CODE = "1";
		try {
			expect(detectEnvironment()).toBe("claude-code");
		} finally {
			if (original === undefined) {
				delete process.env.CLAUDE_CODE;
			} else {
				process.env.CLAUDE_CODE = original;
			}
		}
	});

	test("detects Claude Code from CLAUDE_PROJECT_DIR env var", () => {
		const original = process.env.CLAUDE_PROJECT_DIR;
		process.env.CLAUDE_PROJECT_DIR = "/tmp/test";
		try {
			expect(detectEnvironment()).toBe("claude-code");
		} finally {
			if (original === undefined) {
				delete process.env.CLAUDE_PROJECT_DIR;
			} else {
				process.env.CLAUDE_PROJECT_DIR = original;
			}
		}
	});

	test("returns generic when no known env vars are set", () => {
		// Save and clear known env vars
		const saved: Record<string, string | undefined> = {};
		for (const key of ["CLAUDE_CODE", "CLAUDE_PROJECT_DIR"]) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
		// Also clear any CURSOR_ or GITHUB_COPILOT_ vars
		const cursorKeys = Object.keys(process.env).filter((k) =>
			k.startsWith("CURSOR_"),
		);
		const copilotKeys = Object.keys(process.env).filter((k) =>
			k.startsWith("GITHUB_COPILOT_"),
		);
		for (const key of [...cursorKeys, ...copilotKeys]) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
		try {
			expect(detectEnvironment()).toBe("generic");
		} finally {
			for (const [key, val] of Object.entries(saved)) {
				if (val === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = val;
				}
			}
		}
	});
});

describe("ensureClaudeSettings", () => {
	test("creates .claude/settings.json when missing", () => {
		makeGitRepo(tmpDir);
		const created = ensureClaudeSettings(tmpDir);
		expect(created).toBe(true);
		const settingsPath = join(tmpDir, ".claude", "settings.json");
		expect(existsSync(settingsPath)).toBe(true);
		const content = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(content.mcpServers.maina).toBeDefined();
		expect(content.mcpServers.maina.command).toBe("npx");
		expect(content.mcpServers.maina.args).toEqual(["@mainahq/cli", "--mcp"]);
	});

	test("merges into existing settings without maina", () => {
		makeGitRepo(tmpDir);
		const claudeDir = join(tmpDir, ".claude");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(
			join(claudeDir, "settings.json"),
			JSON.stringify({ mcpServers: { other: { command: "other" } } }),
		);

		const created = ensureClaudeSettings(tmpDir);
		expect(created).toBe(true);
		const content = JSON.parse(
			readFileSync(join(claudeDir, "settings.json"), "utf-8"),
		);
		expect(content.mcpServers.maina).toBeDefined();
		expect(content.mcpServers.other).toBeDefined();
	});

	test("skips when maina already configured", () => {
		makeGitRepo(tmpDir);
		const claudeDir = join(tmpDir, ".claude");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(
			join(claudeDir, "settings.json"),
			JSON.stringify({
				mcpServers: {
					maina: { command: "npx", args: ["@mainahq/cli", "--mcp"] },
				},
			}),
		);

		const created = ensureClaudeSettings(tmpDir);
		expect(created).toBe(false);
	});

	test("handles invalid JSON by overwriting", () => {
		makeGitRepo(tmpDir);
		const claudeDir = join(tmpDir, ".claude");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(join(claudeDir, "settings.json"), "not valid json");

		const created = ensureClaudeSettings(tmpDir);
		expect(created).toBe(true);
		const content = JSON.parse(
			readFileSync(join(claudeDir, "settings.json"), "utf-8"),
		);
		expect(content.mcpServers.maina).toBeDefined();
	});
});

describe("buildClaudeSettingsJson", () => {
	test("returns valid JSON with maina MCP server", () => {
		const json = buildClaudeSettingsJson();
		const content = JSON.parse(json);
		expect(content.mcpServers.maina.command).toBe("npx");
		expect(content.mcpServers.maina.args).toEqual(["@mainahq/cli", "--mcp"]);
	});
});

describe("setupAction", () => {
	test("detects environment from injected detector", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps({ detectEnv: () => "claude-code" });
		const result = await setupAction({ cwd: tmpDir }, deps);
		expect(result.environment).toBe("claude-code");
	});

	test("creates .claude/settings.json for Claude Code environment", async () => {
		makeGitRepo(tmpDir);
		// Create .mcp.json to simulate init
		writeFileSync(
			join(tmpDir, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					maina: { command: "npx", args: ["@mainahq/cli", "--mcp"] },
				},
			}),
		);
		const deps = makeDeps({ detectEnv: () => "claude-code" });
		const result = await setupAction({ cwd: tmpDir }, deps);

		expect(result.claudeSettingsCreated).toBe(true);
		expect(existsSync(join(tmpDir, ".claude", "settings.json"))).toBe(true);
	});

	test("does not create .claude/settings.json for non-Claude environments", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps({ detectEnv: () => "cursor" });
		const result = await setupAction({ cwd: tmpDir }, deps);

		expect(result.claudeSettingsCreated).toBe(false);
		expect(existsSync(join(tmpDir, ".claude", "settings.json"))).toBe(false);
	});

	test("runs init and reports success", async () => {
		makeGitRepo(tmpDir);
		let initCalled = false;
		const deps = makeDeps({
			runInit: async () => {
				initCalled = true;
				return true;
			},
		});

		const result = await setupAction({ cwd: tmpDir }, deps);

		expect(initCalled).toBe(true);
		expect(result.initSuccess).toBe(true);
	});

	test("runs init and reports failure", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps({
			runInit: async () => false,
		});

		const result = await setupAction({ cwd: tmpDir }, deps);

		expect(result.initSuccess).toBe(false);
	});

	test("runs doctor and reports tools", async () => {
		makeGitRepo(tmpDir);
		let doctorCalled = false;
		const deps = makeDeps({
			runDoctor: async () => {
				doctorCalled = true;
				return makeDoctorResult();
			},
		});

		const result = await setupAction({ cwd: tmpDir }, deps);

		expect(doctorCalled).toBe(true);
		expect(result.doctorResult).not.toBeNull();
		expect(result.doctorResult?.tools).toHaveLength(2);
	});

	test("handles non-interactive mode with --yes", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps();
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);

		expect(result.initSuccess).toBe(true);
	});

	test("json mode returns structured result", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps();
		const result = await setupAction({ cwd: tmpDir, json: true }, deps);

		expect(result.environment).toBeDefined();
		expect(result.initSuccess).toBeDefined();
		expect(result.mcpConfigured).toBeDefined();
		expect(result.doctorResult).toBeDefined();
	});

	test("detects .mcp.json as configured", async () => {
		makeGitRepo(tmpDir);
		writeFileSync(join(tmpDir, ".mcp.json"), "{}");
		const deps = makeDeps();
		const result = await setupAction({ cwd: tmpDir }, deps);

		expect(result.mcpConfigured).toBe(true);
	});

	test("reports .mcp.json as missing when not present", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps();
		const result = await setupAction({ cwd: tmpDir }, deps);

		expect(result.mcpConfigured).toBe(false);
	});

	test("wiki confirmed sets wikiInitialized when wiki dir exists", async () => {
		makeGitRepo(tmpDir);
		mkdirSync(join(tmpDir, ".maina", "wiki"), { recursive: true });
		const deps = makeDeps({ confirmWiki: async () => true });
		const result = await setupAction({ cwd: tmpDir }, deps);

		expect(result.wikiInitialized).toBe(true);
	});

	test("wiki declined leaves wikiInitialized false", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps({ confirmWiki: async () => false });
		const result = await setupAction({ cwd: tmpDir }, deps);

		expect(result.wikiInitialized).toBe(false);
	});

	test("logs summary messages in non-json mode", async () => {
		makeGitRepo(tmpDir);
		const messages: string[] = [];
		const deps = makeDeps({
			log: {
				info: (msg: string) => messages.push(`info:${msg}`),
				error: (msg: string) => messages.push(`error:${msg}`),
				warning: (msg: string) => messages.push(`warning:${msg}`),
				success: (msg: string) => messages.push(`success:${msg}`),
				message: (msg: string) => messages.push(`message:${msg}`),
				step: (msg: string) => messages.push(`step:${msg}`),
			},
		});

		await setupAction({ cwd: tmpDir }, deps);

		expect(messages.some((m) => m.includes("Setup Summary"))).toBe(true);
		expect(messages.some((m) => m.includes("Environment"))).toBe(true);
		expect(messages.some((m) => m.includes("Init"))).toBe(true);
		expect(messages.some((m) => m.includes("Next steps"))).toBe(true);
	});
});
