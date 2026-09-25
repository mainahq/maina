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
import type { SetupTelemetryEvent } from "../../onboarding/setup/telemetry";
import {
	type SetupActionDeps,
	type SetupActionOptions,
	setupAction,
	setupCommand,
} from "../setup";
import { jsonEmitter, type PhaseEvent } from "../setup-emitter";

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

	test("migrates a 1.x install: stale MCP entries go, the rest is kept (#301)", async () => {
		const home = mkdtempSync(join(tmpdir(), "maina-setup-home-"));
		const stale = { command: "bunx", args: ["@mainahq/cli", "--mcp"] };
		const files: Record<string, string> = {
			".mcp.json": JSON.stringify({ mcpServers: { maina: stale } }, null, 2),
			".claude/settings.json": JSON.stringify(
				{ mcpServers: { maina: stale } },
				null,
				2,
			),
			".maina/constitution.md": "# Ours\n\n- Kept.\n",
			".maina/prompts/review.md": "# Our review prompt\n",
			".maina/feedback.db": "SQLite format 3\u0000fake",
		};
		for (const [rel, content] of Object.entries(files)) {
			mkdirSync(join(cwd, rel, ".."), { recursive: true });
			writeFileSync(join(cwd, rel), content);
		}
		writeFileSync(
			join(home, ".claude.json"),
			JSON.stringify({ mcpServers: { maina: stale } }),
		);
		try {
			const result = await run({ globalHosts: { home } });
			expect(result.bailed).toBe(false);
			expect(
				result.migration.changes.map((c) => [c.path, c.action]).sort(),
			).toEqual(
				[
					[join(cwd, ".mcp.json"), "rewritten"],
					[join(cwd, ".claude/settings.json"), "deleted"],
					[join(home, ".claude.json"), "rewritten"],
				].sort(),
			);
			expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(false);
			const mcp = JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf-8"));
			expect(mcp.mcpServers.maina.args).not.toContain("@mainahq/cli");
			for (const rel of [
				".maina/constitution.md",
				".maina/prompts/review.md",
				".maina/feedback.db",
			]) {
				expect(readFileSync(join(cwd, rel), "utf-8")).toBe(files[rel] ?? "");
			}

			const second = await run({ globalHosts: { home } });
			expect(second.migration.changes).toEqual([]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("plugin mode runs the 1.x migration too", async () => {
		writeFileSync(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					maina: { command: "npx", args: ["@mainahq/cli", "--mcp"] },
				},
			}),
		);
		const result = await run({ plugin: true });
		expect(result.migration.changes.map((c) => c.action)).toEqual([
			"rewritten",
		]);
	});

	test("setup exposes --legacy-agents and --plugin", () => {
		const flags = setupCommand().options.map((o) => o.long);
		expect(flags).toContain("--legacy-agents");
		expect(flags).toContain("--plugin");
	});
});

describe("setupAction — kept constitution skips the AI call (#406)", () => {
	function countingDeps(
		source: "byok" | "degraded" = "byok",
	): SetupActionDeps & { calls: () => number; warnings: string[] } {
		let calls = 0;
		const warnings: string[] = [];
		const base = deps();
		return {
			...base,
			log: { ...base.log, warning: (m: string) => warnings.push(m) },
			resolveAI: async () => {
				calls++;
				return source === "byok"
					? {
							source: "byok",
							text: "# Project Constitution\n\n- Generated rule.\n",
							metadata: {
								source: "byok",
								attemptedSources: ["byok"],
								durationMs: 1,
							},
						}
					: {
							source: "degraded",
							text: "# Project Constitution\n\n- Offline rule.\n",
							metadata: {
								source: "degraded",
								attemptedSources: ["degraded"],
								durationMs: 1,
								reason: "no_key",
							},
						};
			},
			calls: () => calls,
			warnings,
		};
	}

	function keepConstitution(): void {
		mkdirSync(join(cwd, ".maina"), { recursive: true });
		writeFileSync(
			join(cwd, ".maina", "constitution.md"),
			"# Ours\n\n- Kept.\n",
		);
	}

	test("a second run never calls resolveAI and reports aiSource=skipped", async () => {
		const d = countingDeps();
		const first = await run({ deps: d });
		expect(first.aiSource).toBe("byok");
		expect(d.calls()).toBe(1);

		const second = await run({ deps: d });
		expect(d.calls()).toBe(1);
		expect(second.bailed).toBe(false);
		expect(second.aiSource).toBe("skipped");
		expect(second.degraded).toBe(false);
	});

	test("plugin re-runs skip the AI call too", async () => {
		keepConstitution();
		const d = countingDeps();
		const result = await run({ deps: d, plugin: true });
		expect(d.calls()).toBe(0);
		expect(result.aiSource).toBe("skipped");
	});

	test("infer phase is skipped with reason constitution_exists; done is not degraded", async () => {
		keepConstitution();
		const lines: string[] = [];
		const result = await run({
			deps: countingDeps(),
			ci: true,
			emitter: jsonEmitter((l) => lines.push(l)),
		});
		expect(result.bailed).toBe(false);
		const events = lines.map((l) => JSON.parse(l) as PhaseEvent);
		const infer = events.find((e) => e.phase === "infer");
		expect(infer?.status).toBe("skipped");
		expect(infer?.reason).toBe("constitution_exists");
		const done = events.find((e) => e.phase === "done");
		expect(done?.status).toBe("ok");
		expect(done?.aiSource).toBe("skipped");
		expect(done?.degraded).toBe(false);
		expect(done?.tailored).toBe(false);
	});

	test("telemetry reports skipped, neither degraded nor tailored", async () => {
		keepConstitution();
		const savedTelemetry = process.env.MAINA_TELEMETRY;
		delete process.env.MAINA_TELEMETRY;
		let event: SetupTelemetryEvent | undefined;
		try {
			await run({
				deps: countingDeps(),
				telemetry: undefined,
				// Setup telemetry is opt-in (#306); opt in to see the event.
				telemetryConsent: async () => true,
				sendTelemetry: async (opts) => {
					event = opts.event;
					return { sent: true, error: null };
				},
			});
		} finally {
			if (savedTelemetry !== undefined)
				process.env.MAINA_TELEMETRY = savedTelemetry;
		}
		expect(event?.aiSource).toBe("skipped");
		expect(event?.degraded).toBe(false);
		expect(event?.tailored).toBe(false);
	});

	test("a kept constitution never writes a degraded setup.log entry or banner", async () => {
		keepConstitution();
		const d = countingDeps("degraded");
		const result = await run({ deps: d });
		expect(d.calls()).toBe(0);
		expect(result.degraded).toBe(false);
		expect(existsSync(join(cwd, ".maina", "setup.log"))).toBe(false);
		expect(d.warnings.some((w) => w.toLowerCase().includes("degraded"))).toBe(
			false,
		);
	});

	test("--reset still regenerates through resolveAI", async () => {
		keepConstitution();
		const d = countingDeps();
		const result = await run({ deps: d, mode: "reset" });
		expect(d.calls()).toBe(1);
		expect(result.aiSource).toBe("byok");
		expect(result.constitutionWritten).toBe(true);
	});
});
