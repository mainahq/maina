/**
 * `planOnboarding` — the pure half of the single onboarding flow (#288).
 *
 * Facts in (detected stack, generated constitution, MCP entry and the
 * current bytes of every target file), file operations out. These tests
 * pin the four guarantees from the issue:
 *
 * 1. planning is pure and idempotent: plan → apply → plan gives no ops
 * 2. no op ever has kind "overwrite"
 * 3. user content outside managed regions is preserved byte for byte
 * 4. the non-interactive plugin mode writes only `.maina/` and managed
 *    regions of files that already exist
 */

import { describe, expect, test } from "bun:test";
import type { Result } from "@mainahq/core";
import { applyOps, type OnboardingFs, snapshotFiles } from "../apply";
import {
	type FileOp,
	type OnboardingFacts,
	onboardingTargets,
	type PlanOptions,
	planOnboarding,
} from "../plan";
import {
	MAINA_REGION_END,
	MAINA_REGION_START,
} from "../setup/agent-files/region";
import type { StackContext } from "../setup/agent-files/types";

// ── Fixtures ────────────────────────────────────────────────────────────────

const STACK: StackContext = {
	languages: ["typescript"],
	frameworks: [],
	packageManager: "bun",
	buildTool: null,
	linters: ["biome"],
	testRunners: ["bun:test"],
	cicd: ["github-actions"],
	repoSize: { files: 10, bytes: 1000 },
	isEmpty: false,
	isLarge: false,
};

const CONSTITUTION = "# Project Constitution\n\n- Tests first.\n";
const MCP_ENTRY = { command: "bunx", args: ["@mainahq/cli", "--mcp"] };

const LEGACY_PATHS = [
	".aider.conf.yml",
	".clinerules",
	".roo/mcp.json",
	".roo/rules/maina.md",
	".continue/config.yaml",
	".continue/mcpServers/maina.json",
	".amazonq/mcp.json",
	".cursorrules",
	".windsurfrules",
	"CONVENTIONS.md",
	"GEMINI.md",
];

function memoryFs(initial: Record<string, string> = {}): {
	fs: OnboardingFs;
	files: Map<string, string>;
} {
	const files = new Map(Object.entries(initial));
	const fs: OnboardingFs = {
		read: (path): Result<string | null> => ({
			ok: true,
			value: files.get(path) ?? null,
		}),
		write: (path, content): Result<void> => {
			files.set(path, content);
			return { ok: true, value: undefined };
		},
		create: (path, content): Result<"created" | "exists"> => {
			if (files.has(path)) return { ok: true, value: "exists" };
			files.set(path, content);
			return { ok: true, value: "created" };
		},
	};
	return { fs, files };
}

function factsFor(fs: OnboardingFs, options: PlanOptions): OnboardingFacts {
	return {
		stack: STACK,
		constitution: CONSTITUTION,
		mcpEntry: MCP_ENTRY,
		files: snapshotFiles(fs, onboardingTargets(options)),
	};
}

/** One full onboarding pass: snapshot → plan → apply. Returns the ops. */
function runOnce(fs: OnboardingFs, options: PlanOptions = {}): FileOp[] {
	const ops = [...planOnboarding(factsFor(fs, options), options)];
	const applied = applyOps(ops, { fs });
	expect(applied.ok).toBe(true);
	return ops;
}

const USER_CLAUDE_MD = [
	"# My project",
	"",
	"Hand-written notes the user cares about.   ",
	"\ttab-indented line, trailing spaces kept   ",
	"",
].join("\n");

/** Repos in different starting states, reused across the guarantees. */
const SCENARIOS: Record<string, Record<string, string>> = {
	"fresh repo": {},
	"existing user files": {
		"CLAUDE.md": USER_CLAUDE_MD,
		"AGENTS.md": "# Agents\n\nNo trailing newline",
		".claude/settings.json": `${JSON.stringify(
			{ theme: "dark", mcpServers: { memory: { command: "mem" } } },
			null,
			2,
		)}\n`,
		".cursor/mcp.json": `${JSON.stringify({ mcpServers: {} }, null, "\t")}\n`,
		".maina/constitution.md": "# Team constitution\n\nOurs.\n",
	},
	"stale managed regions": {
		"CLAUDE.md": `intro\n${MAINA_REGION_START}\nold maina text\n${MAINA_REGION_END}\noutro\n`,
		".mcp.json": `${JSON.stringify({ mcpServers: { maina: { command: "old" } } }, null, 2)}\n`,
	},
};

// ── 1. Purity and idempotence ───────────────────────────────────────────────

describe("planOnboarding — purity", () => {
	test("same facts give equal plans and the facts are not mutated", () => {
		const { fs } = memoryFs(SCENARIOS["existing user files"]);
		const facts = factsFor(fs, {});
		const before = new Map(facts.files);
		const a = planOnboarding(facts, {});
		const b = planOnboarding(facts, {});
		expect(a).toEqual(b);
		expect(a.length).toBeGreaterThan(0);
		expect(new Map(facts.files)).toEqual(before);
	});
});

describe("planOnboarding — idempotence", () => {
	for (const [name, initial] of Object.entries(SCENARIOS)) {
		for (const options of [
			{},
			{ legacyAgents: true },
			{ managedOnly: true },
		] as PlanOptions[]) {
			test(`${name} ${JSON.stringify(options)}: planning after applying gives no ops`, () => {
				const { fs } = memoryFs(initial);
				runOnce(fs, options);
				expect(planOnboarding(factsFor(fs, options), options)).toEqual([]);
			});
		}
	}

	test("a second full pass writes nothing", () => {
		const { fs, files } = memoryFs(SCENARIOS["existing user files"]);
		runOnce(fs, { legacyAgents: true });
		const afterFirst = new Map(files);
		runOnce(fs, { legacyAgents: true });
		expect(files).toEqual(afterFirst);
	});
});

// ── 2. No overwrite ─────────────────────────────────────────────────────────

describe("planOnboarding — never overwrites", () => {
	for (const [name, initial] of Object.entries(SCENARIOS)) {
		test(`${name}: every op is create, merge-region or merge-json-key`, () => {
			const { fs } = memoryFs(initial);
			const ops = planOnboarding(factsFor(fs, { legacyAgents: true }), {
				legacyAgents: true,
			});
			for (const op of ops) {
				expect(["create", "merge-region", "merge-json-key"]).toContain(op.kind);
				expect(op.kind).not.toBe("overwrite");
			}
		});

		test(`${name}: create ops only target files that do not exist`, () => {
			const { fs } = memoryFs(initial);
			const facts = factsFor(fs, { legacyAgents: true });
			for (const op of planOnboarding(facts, { legacyAgents: true })) {
				if (op.kind === "create") expect(facts.files.has(op.path)).toBe(false);
			}
		});
	}

	test("an existing constitution is left alone", () => {
		const { fs, files } = memoryFs(SCENARIOS["existing user files"]);
		const ops = runOnce(fs);
		expect(ops.map((o) => o.path)).not.toContain(".maina/constitution.md");
		expect(files.get(".maina/constitution.md")).toBe(
			"# Team constitution\n\nOurs.\n",
		);
	});

	test("a YAML legacy file that already exists is never touched", () => {
		const aider = "# my aider config\nmodel: gpt\n";
		const { fs, files } = memoryFs({ ".aider.conf.yml": aider });
		runOnce(fs, { legacyAgents: true });
		expect(files.get(".aider.conf.yml")).toBe(aider);
	});
});

// ── 3. Byte-for-byte preservation ───────────────────────────────────────────

describe("planOnboarding — preserves user content", () => {
	test("markdown without a region: user bytes stay as an exact prefix", () => {
		const { fs, files } = memoryFs({ "CLAUDE.md": USER_CLAUDE_MD });
		runOnce(fs);
		const out = files.get("CLAUDE.md") ?? "";
		expect(out.startsWith(USER_CLAUDE_MD)).toBe(true);
		expect(out).toContain(MAINA_REGION_START);
	});

	test("markdown with a stale region: bytes before and after are identical", () => {
		const before = "# Title\r\n\r\nUser intro   \n\n";
		const after = "\n\n## User section\n\n- keep me\t\n";
		const initial = `${before}${MAINA_REGION_START}\nstale\n${MAINA_REGION_END}${after}`;
		const { fs, files } = memoryFs({ "AGENTS.md": initial });
		runOnce(fs);
		const out = files.get("AGENTS.md") ?? "";
		expect(out.startsWith(`${before}${MAINA_REGION_START}\n`)).toBe(true);
		expect(out.endsWith(`${MAINA_REGION_END}${after}`)).toBe(true);
		expect(out).not.toContain("stale");
	});

	test("JSON: every non-maina key survives with the file's own indent", () => {
		const user = {
			theme: "dark",
			permissions: { allow: ["Bash(ls)"] },
			mcpServers: { memory: { command: "mem", args: ["--x"] } },
		};
		const initial = `${JSON.stringify(user, null, 4)}\n`;
		const { fs, files } = memoryFs({ ".mcp.json": initial });
		runOnce(fs);
		const out = files.get(".mcp.json") ?? "";
		const expected = {
			...user,
			mcpServers: { ...user.mcpServers, maina: MCP_ENTRY },
		};
		expect(out).toBe(`${JSON.stringify(expected, null, 4)}\n`);
	});

	test("a merge into a file that already has maina's region or key still asks for a backup", () => {
		// e.g. files written by 1.x, which kept no backups: the first edit
		// under the new flow must still copy the original bytes aside.
		const { fs, files } = memoryFs(SCENARIOS["stale managed regions"]);
		const ops = runOnce(fs);
		const merges = ops.filter((o) => o.kind !== "create");
		expect(merges.map((o) => o.path).sort()).toEqual([
			".mcp.json",
			"CLAUDE.md",
		]);
		for (const op of merges) expect(op.backup).toBe(true);
		expect(files.get(".maina/backups/CLAUDE.md")).toBe(
			SCENARIOS["stale managed regions"]?.["CLAUDE.md"],
		);
		expect(files.get(".maina/backups/.mcp.json")).toBe(
			SCENARIOS["stale managed regions"]?.[".mcp.json"],
		);
	});

	test("an unmatched start marker never lets a later run eat user content", () => {
		const text = `# mine\n${MAINA_REGION_START}\nuser text after a stray marker\n`;
		const { fs, files } = memoryFs({ "CLAUDE.md": text });
		runOnce(fs, { agents: ["claude"] });
		runOnce(fs, { agents: ["claude"] });
		expect(files.get("CLAUDE.md")).toBe(text);
	});

	test("first merge into an existing file asks for a backup; creates do not", () => {
		const { fs } = memoryFs({
			"CLAUDE.md": USER_CLAUDE_MD,
			".cursor/mcp.json": '{ "mcpServers": {} }\n',
		});
		const first = runOnce(fs);
		const merges = first.filter((o) => o.kind !== "create");
		expect(merges.length).toBeGreaterThan(0);
		for (const op of merges) expect(op.backup).toBe(true);
		for (const op of first.filter((o) => o.kind === "create")) {
			expect(op.backup).toBe(false);
		}
	});
});

// ── 4. Plugin (non-interactive) mode ────────────────────────────────────────

describe("planOnboarding — managedOnly (plugin mode)", () => {
	test("fresh repo: only writes under .maina/", () => {
		const { fs } = memoryFs();
		const ops = planOnboarding(factsFor(fs, { managedOnly: true }), {
			managedOnly: true,
		});
		expect(ops.length).toBeGreaterThan(0);
		for (const op of ops) expect(op.path.startsWith(".maina/")).toBe(true);
	});

	test("existing files: outside .maina/ only managed merges, never creates", () => {
		const { fs, files } = memoryFs(SCENARIOS["existing user files"]);
		const ops = runOnce(fs, { managedOnly: true, legacyAgents: true });
		for (const op of ops) {
			if (op.path.startsWith(".maina/")) continue;
			expect(op.kind).not.toBe("create");
		}
		expect(ops.some((o) => o.path === "CLAUDE.md")).toBe(true);
		// Nothing new appeared outside .maina/.
		const initialPaths = Object.keys(SCENARIOS["existing user files"] ?? {});
		for (const path of files.keys()) {
			if (path.startsWith(".maina/")) continue;
			expect(initialPaths).toContain(path);
		}
	});
});

// ── Target selection ────────────────────────────────────────────────────────

describe("planOnboarding — targets", () => {
	test("legacy agent files are retired unless --legacy-agents", () => {
		for (const path of LEGACY_PATHS) {
			expect(onboardingTargets({})).not.toContain(path);
			expect(onboardingTargets({ legacyAgents: true })).toContain(path);
		}
	});

	test("default fresh plan covers constitution, agent files and MCP keys", () => {
		const { fs } = memoryFs();
		const paths = planOnboarding(factsFor(fs, {}), {}).map((o) => o.path);
		for (const p of [
			".maina/constitution.md",
			"AGENTS.md",
			"CLAUDE.md",
			".cursor/rules/maina.mdc",
			".github/copilot-instructions.md",
			".windsurf/rules/maina.md",
			".mcp.json",
			".cursor/mcp.json",
		]) {
			expect(paths).toContain(p);
		}
	});

	test("a Claude MCP entry is never planned into settings.json (P1)", () => {
		// Claude Code reads `.mcp.json` / `~/.claude.json`, never settings.
		const { fs } = memoryFs(SCENARIOS["existing user files"]);
		for (const options of [{}, { legacyAgents: true }] as PlanOptions[]) {
			expect(onboardingTargets(options)).not.toContain(".claude/settings.json");
			const paths = planOnboarding(factsFor(fs, options), options).map(
				(o) => o.path,
			);
			expect(paths).not.toContain(".claude/settings.json");
			expect(paths).not.toContain(".claude/settings.local.json");
		}
	});

	test("agents option scopes the instruction files", () => {
		const options: PlanOptions = { agents: ["claude"] };
		const { fs } = memoryFs();
		const paths = planOnboarding(factsFor(fs, options), options).map(
			(o) => o.path,
		);
		expect(paths).toContain("CLAUDE.md");
		expect(paths).not.toContain("AGENTS.md");
		expect(paths).not.toContain(".windsurf/rules/maina.md");
	});

	test("agent files quote the existing constitution, not a regenerated one", () => {
		const { fs, files } = memoryFs({
			".maina/constitution.md": "# Team constitution\n\n- Ship small.\n",
		});
		runOnce(fs, { agents: ["claude"] });
		expect(files.get("CLAUDE.md")).toContain("Ship small.");
		expect(files.get("CLAUDE.md")).not.toContain("Tests first.");
	});
});
