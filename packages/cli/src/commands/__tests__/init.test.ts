import {
	afterEach,
	beforeEach,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";

// bootstrap() spawns tool-detection processes — CI needs more time
setDefaultTimeout(15_000);

import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectAIAvailability,
	ensureGitignoreHasMainaEnv,
	type InitActionDeps,
	initAction,
	saveApiKeyToEnv,
} from "../init";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-init-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeGitRepo(dir: string): void {
	mkdirSync(join(dir, ".git"), { recursive: true });
}

function makeDeps(overrides?: Partial<InitActionDeps>): InitActionDeps {
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
		// Default: no API key, not in host mode, skip prompt
		checkApiKey: () => null,
		checkHostMode: () => false,
		promptApiKey: async () => ({ action: "skip" }),
		...overrides,
	};
}

describe("maina init CLI", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("successful init shows created files", async () => {
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

		const result = await initAction({ cwd: tmpDir }, deps);

		expect(result.ok).toBe(true);
		// Should have logged created files
		const successMessages = messages.filter((m) => m.startsWith("success:"));
		expect(successMessages.length).toBeGreaterThan(0);
		// .maina directory should exist
		expect(existsSync(join(tmpDir, ".maina"))).toBe(true);
	});

	test("already initialized shows skipped files", async () => {
		makeGitRepo(tmpDir);
		const mainaDir = join(tmpDir, ".maina");
		mkdirSync(mainaDir, { recursive: true });
		writeFileSync(join(mainaDir, "constitution.md"), "existing\n");
		writeFileSync(join(tmpDir, "AGENTS.md"), "existing\n");

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

		const result = await initAction({ cwd: tmpDir }, deps);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.skipped.length).toBeGreaterThan(0);
		}
		// Should mention skipped files
		const warningMessages = messages.filter((m) => m.startsWith("warning:"));
		expect(warningMessages.length).toBeGreaterThan(0);
	});

	test("--force flag passed through", async () => {
		makeGitRepo(tmpDir);
		const mainaDir = join(tmpDir, ".maina");
		mkdirSync(mainaDir, { recursive: true });
		writeFileSync(join(mainaDir, "constitution.md"), "old content\n");

		const deps = makeDeps();
		const result = await initAction({ cwd: tmpDir, force: true }, deps);

		expect(result.ok).toBe(true);
		if (result.ok) {
			// With force, constitution.md should be created (overwritten), not skipped
			expect(result.value.created).toContain(".maina/constitution.md");
			expect(result.value.skipped).not.toContain(".maina/constitution.md");
		}
	});

	test("shows detected verification tools", async () => {
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

		const result = await initAction({ cwd: tmpDir }, deps);

		expect(result.ok).toBe(true);
		// Should display either available tools or missing tools
		const toolMessages = messages.filter(
			(m) => m.includes("Verification tools") || m.includes("Missing tools"),
		);
		expect(toolMessages.length).toBeGreaterThan(0);
	});

	test("fails if not a git repo", async () => {
		// tmpDir has no .git directory
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

		const result = await initAction({ cwd: tmpDir }, deps);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("git");
		}
	});

	// ── API Key Detection ─────────────────────────────────────────────────

	test("detectAIAvailability returns hasKey when API key exists", () => {
		const deps = makeDeps({ checkApiKey: () => "sk-test-key" });
		const result = detectAIAvailability(deps);
		expect(result.hasKey).toBe(true);
		expect(result.inHostMode).toBe(false);
	});

	test("detectAIAvailability returns inHostMode when in host mode", () => {
		const deps = makeDeps({ checkHostMode: () => true });
		const result = detectAIAvailability(deps);
		expect(result.hasKey).toBe(false);
		expect(result.inHostMode).toBe(true);
	});

	test("detectAIAvailability returns neither when no key and not host", () => {
		const deps = makeDeps({
			checkApiKey: () => null,
			checkHostMode: () => false,
		});
		const result = detectAIAvailability(deps);
		expect(result.hasKey).toBe(false);
		expect(result.inHostMode).toBe(false);
	});

	test("logs API key found when key exists", async () => {
		makeGitRepo(tmpDir);
		const messages: string[] = [];
		const deps = makeDeps({
			checkApiKey: () => "sk-test-key",
			log: {
				info: (msg: string) => messages.push(`info:${msg}`),
				error: (msg: string) => messages.push(`error:${msg}`),
				warning: (msg: string) => messages.push(`warning:${msg}`),
				success: (msg: string) => messages.push(`success:${msg}`),
				message: (msg: string) => messages.push(`message:${msg}`),
				step: (msg: string) => messages.push(`step:${msg}`),
			},
		});

		await initAction({ cwd: tmpDir }, deps);

		expect(messages).toContain("success:API key found");
	});

	test("logs host mode when in host mode", async () => {
		makeGitRepo(tmpDir);
		const messages: string[] = [];
		const deps = makeDeps({
			checkHostMode: () => true,
			log: {
				info: (msg: string) => messages.push(`info:${msg}`),
				error: (msg: string) => messages.push(`error:${msg}`),
				warning: (msg: string) => messages.push(`warning:${msg}`),
				success: (msg: string) => messages.push(`success:${msg}`),
				message: (msg: string) => messages.push(`message:${msg}`),
				step: (msg: string) => messages.push(`step:${msg}`),
			},
		});

		await initAction({ cwd: tmpDir }, deps);

		expect(messages.some((m) => m.includes("host delegation"))).toBe(true);
	});

	test("prompts for API key when none available", async () => {
		makeGitRepo(tmpDir);
		const messages: string[] = [];
		let promptCalled = false;
		const deps = makeDeps({
			checkApiKey: () => null,
			checkHostMode: () => false,
			promptApiKey: async () => {
				promptCalled = true;
				return { action: "skip" };
			},
			log: {
				info: (msg: string) => messages.push(`info:${msg}`),
				error: (msg: string) => messages.push(`error:${msg}`),
				warning: (msg: string) => messages.push(`warning:${msg}`),
				success: (msg: string) => messages.push(`success:${msg}`),
				message: (msg: string) => messages.push(`message:${msg}`),
				step: (msg: string) => messages.push(`step:${msg}`),
			},
		});

		await initAction({ cwd: tmpDir }, deps);

		expect(promptCalled).toBe(true);
		expect(messages).toContain(
			"warning:Skipped API key — AI features will be limited",
		);
	});

	test("saves API key when user enters one", async () => {
		makeGitRepo(tmpDir);
		const messages: string[] = [];
		const deps = makeDeps({
			checkApiKey: () => null,
			checkHostMode: () => false,
			promptApiKey: async () => ({
				action: "enter",
				key: "sk-or-v1-testkey123",
			}),
			log: {
				info: (msg: string) => messages.push(`info:${msg}`),
				error: (msg: string) => messages.push(`error:${msg}`),
				warning: (msg: string) => messages.push(`warning:${msg}`),
				success: (msg: string) => messages.push(`success:${msg}`),
				message: (msg: string) => messages.push(`message:${msg}`),
				step: (msg: string) => messages.push(`step:${msg}`),
			},
		});

		await initAction({ cwd: tmpDir }, deps);

		// Check .maina/.env was created with key
		const envPath = join(tmpDir, ".maina", ".env");
		expect(existsSync(envPath)).toBe(true);
		const envContent = readFileSync(envPath, "utf-8");
		expect(envContent).toContain("OPENROUTER_API_KEY=sk-or-v1-testkey123");

		// Check .gitignore was updated
		const gitignorePath = join(tmpDir, ".gitignore");
		expect(existsSync(gitignorePath)).toBe(true);
		const gitignoreContent = readFileSync(gitignorePath, "utf-8");
		expect(gitignoreContent).toContain(".maina/.env");

		expect(messages).toContain("success:API key saved to .maina/.env");
	});

	// ── .gitignore management ─────────────────────────────────────────────

	test("ensureGitignoreHasMainaEnv creates .gitignore if missing", () => {
		ensureGitignoreHasMainaEnv(tmpDir);
		const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
		expect(content).toBe(".maina/.env\n");
	});

	test("ensureGitignoreHasMainaEnv appends to existing .gitignore", () => {
		writeFileSync(join(tmpDir, ".gitignore"), "node_modules/\n");
		ensureGitignoreHasMainaEnv(tmpDir);
		const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
		expect(content).toBe("node_modules/\n.maina/.env\n");
	});

	test("ensureGitignoreHasMainaEnv does not duplicate entry", () => {
		writeFileSync(join(tmpDir, ".gitignore"), ".maina/.env\nother\n");
		ensureGitignoreHasMainaEnv(tmpDir);
		const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
		expect(content).toBe(".maina/.env\nother\n");
	});

	test("ensureGitignoreHasMainaEnv handles missing trailing newline", () => {
		writeFileSync(join(tmpDir, ".gitignore"), "node_modules/");
		ensureGitignoreHasMainaEnv(tmpDir);
		const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
		expect(content).toBe("node_modules/\n.maina/.env\n");
	});

	// ── saveApiKeyToEnv ───────────────────────────────────────────────────

	test("saveApiKeyToEnv writes key to .maina/.env", () => {
		mkdirSync(join(tmpDir, ".maina"), { recursive: true });
		saveApiKeyToEnv(tmpDir, "sk-or-v1-mykey");
		const content = readFileSync(join(tmpDir, ".maina", ".env"), "utf-8");
		expect(content).toBe("OPENROUTER_API_KEY=sk-or-v1-mykey\n");
	});

	// ── Agent files and MCP in output ─────────────────────────────────────

	test("shows MCP configured message when .mcp.json created", async () => {
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

		await initAction({ cwd: tmpDir }, deps);

		expect(messages.some((m) => m.includes("MCP configured"))).toBe(true);
	});

	test("shows agent files list when created", async () => {
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

		await initAction({ cwd: tmpDir }, deps);

		expect(messages.some((m) => m.includes("Agent files:"))).toBe(true);
	});

	test("next steps mention MCP and agent files", async () => {
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

		await initAction({ cwd: tmpDir }, deps);

		expect(messages.some((m) => m.includes(".mcp.json"))).toBe(true);
		expect(messages.some((m) => m.includes("CLAUDE.md"))).toBe(true);
		expect(messages.some((m) => m.includes("GEMINI.md"))).toBe(true);
		expect(messages.some((m) => m.includes(".cursorrules"))).toBe(true);
	});
});
