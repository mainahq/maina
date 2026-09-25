/**
 * `nodeOnboardingFs` — the real filesystem adapter for onboarding (#288).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyOps, snapshotFiles } from "../apply";
import { nodeOnboardingFs } from "../node-fs";
import { onboardingTargets, planOnboarding } from "../plan";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "maina-node-fs-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("nodeOnboardingFs", () => {
	test("read returns null for a missing file and the bytes otherwise", () => {
		const fs = nodeOnboardingFs(root);
		expect(fs.read("missing.md")).toEqual({ ok: true, value: null });
		writeFileSync(join(root, "here.md"), "hi\n");
		expect(fs.read("here.md")).toEqual({ ok: true, value: "hi\n" });
	});

	test("read of a directory is an error, not a missing file", () => {
		mkdirSync(join(root, "dir"));
		expect(nodeOnboardingFs(root).read("dir").ok).toBe(false);
	});

	test("write creates parent directories and leaves no temp files", () => {
		const fs = nodeOnboardingFs(root);
		expect(fs.write("a/b/c.md", "x").ok).toBe(true);
		expect(readFileSync(join(root, "a/b/c.md"), "utf-8")).toBe("x");
		expect(readdirSync(join(root, "a/b"))).toEqual(["c.md"]);
	});

	test("create writes a missing file and never replaces an existing one", () => {
		const fs = nodeOnboardingFs(root);
		expect(fs.create("new/a.md", "x")).toEqual({ ok: true, value: "created" });
		expect(readFileSync(join(root, "new/a.md"), "utf-8")).toBe("x");
		expect(fs.create("new/a.md", "y")).toEqual({ ok: true, value: "exists" });
		expect(readFileSync(join(root, "new/a.md"), "utf-8")).toBe("x");
		expect(readdirSync(join(root, "new"))).toEqual(["a.md"]);
	});

	test("create treats a dangling symlink as existing", () => {
		symlinkSync("nowhere.md", join(root, "CLAUDE.md"));
		const fs = nodeOnboardingFs(root);
		expect(fs.create("CLAUDE.md", "x")).toEqual({ ok: true, value: "exists" });
		expect(lstatSync(join(root, "CLAUDE.md")).isSymbolicLink()).toBe(true);
	});

	test("read refuses a symlink instead of following it", () => {
		const outside = mkdtempSync(join(tmpdir(), "maina-node-fs-out-"));
		try {
			writeFileSync(join(outside, "CLAUDE.md"), "external\n");
			symlinkSync(join(outside, "CLAUDE.md"), join(root, "CLAUDE.md"));
			expect(nodeOnboardingFs(root).read("CLAUDE.md").ok).toBe(false);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	test("a symlinked parent directory is never read, written or created through", () => {
		const outside = mkdtempSync(join(tmpdir(), "maina-node-fs-out-"));
		try {
			writeFileSync(join(outside, "mcp.json"), '{ "mcpServers": {} }\n');
			symlinkSync(outside, join(root, ".cursor"));
			const fs = nodeOnboardingFs(root);
			expect(fs.read(".cursor/mcp.json").ok).toBe(false);
			expect(fs.write(".cursor/mcp.json", "{}").ok).toBe(false);
			expect(fs.create(".cursor/rules/maina.mdc", "x").ok).toBe(false);
			expect(readFileSync(join(outside, "mcp.json"), "utf-8")).toBe(
				'{ "mcpServers": {} }\n',
			);
			expect(readdirSync(outside)).toEqual(["mcp.json"]);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	test("write refuses to replace a symlink with a regular file", () => {
		writeFileSync(join(root, "AGENTS.md"), "# Agents\n");
		symlinkSync("AGENTS.md", join(root, "CLAUDE.md"));
		const result = nodeOnboardingFs(root).write("CLAUDE.md", "replaced");
		expect(result.ok).toBe(false);
		expect(lstatSync(join(root, "CLAUDE.md")).isSymbolicLink()).toBe(true);
		expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe("# Agents\n");
	});

	test("a symlinked CLAUDE.md -> AGENTS.md survives setup and stays stable", () => {
		writeFileSync(join(root, "AGENTS.md"), "# Agents\n");
		symlinkSync("AGENTS.md", join(root, "CLAUDE.md"));
		const fs = nodeOnboardingFs(root);
		const facts = () => ({
			stack: {
				languages: ["typescript"],
				frameworks: [],
				packageManager: "bun",
				buildTool: null,
				linters: [],
				testRunners: [],
				cicd: [],
				repoSize: { files: 1, bytes: 1 },
				isEmpty: false,
				isLarge: false,
			},
			constitution: "# Constitution\n",
			mcpEntry: { command: "maina", args: ["--mcp"] },
			files: snapshotFiles(
				fs,
				onboardingTargets({ agents: ["agents", "claude"] }),
			),
		});
		const opts = { agents: ["agents", "claude"] as const };
		const first = applyOps(planOnboarding(facts(), opts), { fs });
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		expect(first.value.skipped.map((s) => s.path)).toContain("CLAUDE.md");
		expect(lstatSync(join(root, "CLAUDE.md")).isSymbolicLink()).toBe(true);
		const agents = readFileSync(join(root, "AGENTS.md"), "utf-8");
		expect(agents).toStartWith("# Agents\n");

		// A second run leaves AGENTS.md alone (no flip-flop between the two
		// bodies through the shared file).
		const second = applyOps(planOnboarding(facts(), opts), { fs });
		expect(second.ok).toBe(true);
		expect(readFileSync(join(root, "AGENTS.md"), "utf-8")).toBe(agents);
		expect(lstatSync(join(root, "CLAUDE.md")).isSymbolicLink()).toBe(true);
	});
});
