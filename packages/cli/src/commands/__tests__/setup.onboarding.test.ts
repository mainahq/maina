/**
 * `setupAction` runs the single plan → apply onboarding flow (#288).
 *
 * Heavy dependencies (AI, stack detection, verify, wiki) are stubbed; the
 * file writes are real, inside a throwaway directory.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
import {
	type SetupActionDeps,
	type SetupActionOptions,
	setupAction,
	setupCommand,
} from "../setup";

const LEGACY = [
	".aider.conf.yml",
	".clinerules",
	".roo/mcp.json",
	".cursorrules",
];

function deps(): SetupActionDeps {
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
		spinner: () => ({ start: () => {}, stop: () => {} }),
		isGitRepo: () => true,
		isDirty: async () => false,
		resolveAI: async () => ({
			source: "byok",
			text: "# Project Constitution\n\n- Generated rule.\n",
			metadata: { source: "byok", attemptedSources: ["byok"], durationMs: 1 },
		}),
		assembleStack: async () => ({
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
}

let cwd: string;
let savedCi: string | undefined;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "maina-setup-onboarding-"));
	mkdirSync(join(cwd, ".git"), { recursive: true });
	savedCi = process.env.CI;
	delete process.env.CI;
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
	if (savedCi === undefined) delete process.env.CI;
	else process.env.CI = savedCi;
});

function run(extra: Partial<SetupActionOptions> = {}) {
	return setupAction({
		cwd,
		yes: true,
		telemetry: false,
		sendTelemetry: async () => ({ sent: false, error: null }),
		deps: deps(),
		...extra,
	});
}

describe("setupAction — single onboarding flow", () => {
	test("legacy agent files are not written by default", async () => {
		const result = await run();
		expect(result.bailed).toBe(false);
		expect(existsSync(join(cwd, "AGENTS.md"))).toBe(true);
		for (const path of LEGACY) expect(existsSync(join(cwd, path))).toBe(false);
	});

	test("legacyAgents opts back into the retired files", async () => {
		await run({ legacyAgents: true });
		for (const path of LEGACY) expect(existsSync(join(cwd, path))).toBe(true);
	});

	test("a second run writes nothing", async () => {
		await run();
		const second = await run();
		expect(second.bailed).toBe(false);
		expect(second.constitutionWritten).toBe(false);
		// Skills deploy reports every skill it checked; onboarding files none.
		expect(
			second.agentFilesWritten.filter((p) => !p.startsWith(".maina/skills/")),
		).toEqual([]);
	});

	test("update keeps the existing constitution byte for byte", async () => {
		mkdirSync(join(cwd, ".maina"), { recursive: true });
		const mine = "# Team constitution\n\n- Ours, hand-edited.  \n";
		writeFileSync(join(cwd, ".maina", "constitution.md"), mine);
		const result = await run({ mode: "update" });
		expect(result.bailed).toBe(false);
		expect(result.constitutionWritten).toBe(false);
		expect(readFileSync(join(cwd, ".maina", "constitution.md"), "utf-8")).toBe(
			mine,
		);
		// Agent files quote the constitution that is actually on disk.
		expect(readFileSync(join(cwd, "CLAUDE.md"), "utf-8")).toContain(
			"Ours, hand-edited.",
		);
	});

	test("plugin mode writes only .maina/ and managed regions of existing files", async () => {
		writeFileSync(join(cwd, "CLAUDE.md"), "# Mine\n");
		const result = await run({ plugin: true });
		expect(result.bailed).toBe(false);
		expect(existsSync(join(cwd, ".maina", "constitution.md"))).toBe(true);
		expect(readFileSync(join(cwd, "CLAUDE.md"), "utf-8")).toStartWith(
			"# Mine\n",
		);
		for (const path of [
			"AGENTS.md",
			".mcp.json",
			".claude/settings.json",
			".cursor/mcp.json",
			".github/copilot-instructions.md",
		]) {
			expect(existsSync(join(cwd, path))).toBe(false);
		}
	});

	test("unwritable targets surface as warnings, not failures", async () => {
		// A regular file named `.cursor` blocks `.cursor/rules/maina.mdc`.
		writeFileSync(join(cwd, ".cursor"), "blocker");
		const result = await run();
		expect(result.bailed).toBe(false);
		expect(
			result.agentFilesWarnings.some((w) =>
				w.includes(".cursor/rules/maina.mdc"),
			),
		).toBe(true);
	});

	test("a constitution path that is not a readable file bails", async () => {
		mkdirSync(join(cwd, ".maina", "constitution.md"), { recursive: true });
		const result = await run();
		expect(result.bailed).toBe(true);
		expect(result.bailReason).toBe("constitution_write_failed");
	});

	test("no Claude MCP entry lands in .claude/settings.json (P1)", async () => {
		await run();
		expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(false);
		const mcp = JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf-8"));
		expect(mcp.mcpServers.maina).toBeDefined();
	});

	test("registers maina with installed global-only hosts (Codex) when given a home", async () => {
		const home = mkdtempSync(join(tmpdir(), "maina-setup-home-"));
		mkdirSync(join(home, ".codex"), { recursive: true });
		const before = 'model = "o3"\n';
		writeFileSync(join(home, ".codex", "config.toml"), before);
		try {
			const result = await run({ globalHosts: { home } });
			expect(result.bailed).toBe(false);
			const out = readFileSync(join(home, ".codex", "config.toml"), "utf-8");
			expect(out.startsWith(before)).toBe(true);
			expect(out).toContain("[mcp_servers.maina]");
			expect(result.hostConfigsWritten).toContain(
				join(home, ".codex", "config.toml"),
			);
			// Plugin mode never writes outside the repo's .maina/.
			rmSync(join(home, ".codex", "config.toml"));
			await run({ globalHosts: { home }, plugin: true });
			expect(existsSync(join(home, ".codex", "config.toml"))).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("without a home, setup leaves global host configs alone", async () => {
		const result = await run();
		expect(result.hostConfigsWritten).toEqual([]);
	});

	test("setup exposes --legacy-agents and --plugin", () => {
		const flags = setupCommand().options.map((o) => o.long);
		expect(flags).toContain("--legacy-agents");
		expect(flags).toContain("--plugin");
	});
});
