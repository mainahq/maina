/**
 * Generated reference pages and facts (#357, FR-DOC-3, FR-DOC-6).
 *
 * `scripts/docs-manifest.ts` renders the reference pages, `facts.ts`, the
 * roadmap and the changelog from the code registries and the changesets.
 * `docs:check` fails when a generated file is stale, or when a hand-written
 * page states a count, a version or a tool name that is not taken from
 * `facts.ts`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configJsonSchema } from "../../packages/core/src/config/schema";
import { DECISION_TYPES } from "../../packages/core/src/policy/schema";
import { VERSION } from "../../packages/core/src/version";
import { ALL_TOOLS } from "../../packages/mcp/src/catalog";
import { CLAUDE_HOOK_MAP } from "../../packages/runtime/src/adapters/claude-code";
import { CODEX_HOOK_MAP } from "../../packages/runtime/src/adapters/codex";
import { CURSOR_HOOK_MAP } from "../../packages/runtime/src/adapters/cursor";
import { nativeEvents } from "../../packages/runtime/src/adapters/hook-map";
import {
	checkHandWrittenDocs,
	collectFacts,
	type Facts,
	GENERATED_DOCS,
	generateDocs,
	parseChangeset,
	renderRoadmap,
	scanHandWritten,
	staleDocs,
} from "../docs-manifest";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const DOCS = "packages/docs/src/content/docs";

const page = (docs: ReadonlyMap<string, string>, name: string): string => {
	const text = docs.get(`${DOCS}/${name}`);
	if (text === undefined) throw new Error(`${name} was not generated`);
	return text;
};

describe("generateDocs", () => {
	const docs = generateDocs(REPO_ROOT);

	test("is deterministic: same registries, same bytes, no timestamps", () => {
		const again = generateDocs(REPO_ROOT);
		expect([...again.entries()]).toEqual([...docs.entries()]);
		for (const text of docs.values()) {
			expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
		}
	});

	test("writes exactly the declared generated files", () => {
		expect([...docs.keys()].sort()).toEqual([...GENERATED_DOCS].sort());
		for (const name of [
			"commands",
			"mcp-tools",
			"hooks",
			"config",
			"policy",
			"decision-types",
		]) {
			expect(GENERATED_DOCS).toContain(`${DOCS}/reference/${name}.mdx`);
		}
		expect(GENERATED_DOCS).toContain("packages/docs/src/data/facts.ts");
	});

	test("the committed generated files are up to date", () => {
		expect(staleDocs(REPO_ROOT)).toEqual([]);
	});

	test("the commands page lists every visible command", () => {
		const facts = collectFacts(REPO_ROOT);
		const text = page(docs, "reference/commands.mdx");
		expect(facts.commands.names.length).toBeGreaterThan(0);
		for (const name of facts.commands.names) {
			expect(text).toContain(`## \`maina ${name}`);
		}
	});

	test("the MCP tools page lists every tool", () => {
		const text = page(docs, "reference/mcp-tools.mdx");
		for (const tool of ALL_TOOLS) expect(text).toContain(`\`${tool}\``);
	});

	test("the hooks page maps every lifecycle event to each host", () => {
		const text = page(docs, "reference/hooks.mdx");
		for (const event of [
			"session.start",
			"tool.before",
			"permission.request",
			"file.edited",
			"session.stop",
		]) {
			expect(text).toContain(`\`${event}\``);
		}
		for (const map of [CLAUDE_HOOK_MAP, CODEX_HOOK_MAP, CURSOR_HOOK_MAP]) {
			for (const native of nativeEvents(map)) {
				expect(text).toContain(`\`${native}\``);
			}
		}
	});

	test("the config and policy pages cover every top-level key", () => {
		const config = page(docs, "reference/config.mdx");
		const properties = (configJsonSchema() as { properties: object })
			.properties;
		for (const key of Object.keys(properties).filter((k) => k !== "$schema")) {
			expect(config).toContain(`\`${key}\``);
		}
		const policy = page(docs, "reference/policy.mdx");
		for (const key of [
			"explicitly_allow",
			"action_classes",
			"rules",
			"protected_branches",
			"decisions",
			"telemetry",
			"run",
			"discovery",
			"git.push.force",
			"rules.allow[].match",
			"rules.allow[].kind",
		]) {
			expect(policy).toContain(`\`${key}\``);
		}
	});

	test("the decision types page lists every decision type", () => {
		const text = page(docs, "reference/decision-types.mdx");
		for (const type of DECISION_TYPES) expect(text).toContain(`\`${type}\``);
	});

	test("facts.ts carries the versions, counts, licence and telemetry wording", () => {
		const facts = collectFacts(REPO_ROOT);
		expect(facts.version).toBe(VERSION);
		expect(facts.licence).toBe("Apache-2.0");
		expect(facts.mcpTools.all).toEqual([...ALL_TOOLS]);
		expect(facts.decisionTypes.count).toBe(DECISION_TYPES.length);
		expect(facts.telemetry.channels).toEqual([
			"crash_reports",
			"usage",
			"outcome_sharing",
		]);
		expect(facts.telemetry.summary).toContain("off by default");
		const text = docs.get("packages/docs/src/data/facts.ts") ?? "";
		expect(text).toContain(`version: "${VERSION}"`);
		expect(text).toContain('licence: "Apache-2.0"');
		expect(text).toContain("export const facts");
	});

	test("`bun run version` regenerates the docs after the version bump", () => {
		const pkg = JSON.parse(
			readFileSync(join(REPO_ROOT, "package.json"), "utf-8"),
		) as { scripts: Record<string, string> };
		expect(pkg.scripts.version).toMatch(
			/&& bun scripts\/version-source\.ts && bun scripts\/docs-manifest\.ts$/,
		);
		expect(pkg.scripts["docs:generate"]).toBe("bun scripts/docs-manifest.ts");
	});

	test("every generated page says it is generated", () => {
		for (const [path, text] of docs) {
			expect(text).toContain("Generated by scripts/docs-manifest.ts");
			if (path.endsWith(".mdx")) expect(text.startsWith("---\n")).toBe(true);
		}
	});
});

describe("changesets", () => {
	test("parseChangeset reads the bumps and the summary", () => {
		const parsed = parseChangeset(
			'---\n"@mainahq/cli": minor\n"@mainahq/core": patch\n---\n\nAdd `maina foo`. It does things.\n\nMore detail.\n',
		);
		expect(parsed).toEqual({
			bumps: { "@mainahq/cli": "minor", "@mainahq/core": "patch" },
			summary: "Add `maina foo`. It does things.\n\nMore detail.",
		});
	});

	test("the roadmap keeps the first sentence, whatever case the next starts in", () => {
		const roadmap = renderRoadmap(
			[
				{
					id: "feat-3",
					bumps: { "@mainahq/cli": "minor" },
					summary: "New `maina acp`, e.g. for Zed. maina starts the agent.",
				},
			],
			{},
		);
		expect(roadmap).toContain("- New `maina acp`, e.g. for Zed. _(");
		expect(roadmap).not.toContain("maina starts the agent");
	});

	test("the roadmap lists pending changesets, features before fixes", () => {
		const roadmap = renderRoadmap(
			[
				{
					id: "fix-1",
					bumps: { "@mainahq/core": "patch" },
					summary: "Fix a thing. With detail.",
				},
				{
					id: "feat-2",
					bumps: { "@mainahq/cli": "minor" },
					summary: "Add a <feature> with {braces}.",
				},
			],
			{ "@mainahq/cli": "1.2.3", "@mainahq/core": "1.2.3" },
		);
		expect(roadmap.indexOf("Add a")).toBeLessThan(roadmap.indexOf("Fix a"));
		expect(roadmap).toContain("Fix a thing.");
		expect(roadmap).not.toContain("With detail.");
		// MDX would read raw `<` and `{` as JSX.
		expect(roadmap).toContain("&lt;feature&gt;");
		expect(roadmap).toContain("\\{braces\\}");
	});
});

describe("scanHandWritten", () => {
	const facts: Facts = collectFacts(REPO_ROOT);

	test("flags a hand-typed count", () => {
		const hits = scanHandWritten("Maina ships 12 commands.\n", facts);
		expect(hits).toEqual([{ line: 1, kind: "count", match: "12 commands" }]);
	});

	test("flags counts of every registry", () => {
		const text =
			"8 MCP tools\n5 skills\n16 decision types\n5 hook events\n3 hosts\n";
		expect(scanHandWritten(text, facts).map((h) => h.kind)).toEqual([
			"count",
			"count",
			"count",
			"count",
			"count",
		]);
	});

	test("flags a hand-typed version", () => {
		const hits = scanHandWritten(
			"The latest release is `@mainahq/cli@1.6.1`.\n",
			facts,
		);
		expect(hits).toEqual([{ line: 1, kind: "version", match: "1.6.1" }]);
	});

	test("an IP address is not a version", () => {
		expect(scanHandWritten("bound to `127.0.0.1:8787`\n", facts)).toEqual([]);
	});

	test("flags an MCP tool name the catalog does not have", () => {
		const hits = scanHandWritten("Call the `run_tests` MCP tool.\n", facts);
		expect(hits).toEqual([{ line: 1, kind: "tool", match: "run_tests" }]);
		expect(scanHandWritten("Call the `verify` tool.\n", facts)).toEqual([]);
	});

	test("flags a maina command the CLI does not register", () => {
		const hits = scanHandWritten(
			"Run `maina token create`, then `maina verify`.\n\n```bash\nmaina frobnicate --all\n```\n",
			facts,
		);
		expect(hits).toEqual([
			{ line: 1, kind: "command", match: "maina token" },
			{ line: 4, kind: "command", match: "maina frobnicate" },
		]);
	});

	test("values taken from facts.ts pass", () => {
		const text = [
			"import { facts } from '../../data/facts';",
			"",
			"Maina ships {facts.commands.count} commands and {facts.mcpTools.default.length} MCP tools, at {facts.version}.",
		].join("\n");
		expect(scanHandWritten(text, facts)).toEqual([]);
	});

	test("an ignore marker on the line or the line before skips it", () => {
		const text =
			"{/* docs-manifest: ignore */}\n- 38 commands at launch\n- 7 languages <!-- docs-manifest: ignore --> in 1.0.0\n";
		expect(scanHandWritten(text, facts)).toEqual([]);
	});
});

describe("checkHandWrittenDocs", () => {
	let root: string;
	const facts = collectFacts(REPO_ROOT);

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "maina-docs-manifest-"));
		mkdirSync(join(root, DOCS, "reference"), { recursive: true });
		writeFileSync(join(root, "README.md"), "# Maina\n");
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("reports hand-written hits by file and line", () => {
		writeFileSync(
			join(root, DOCS, "guide.mdx"),
			"---\ntitle: Guide\n---\n\nMaina has 99 MCP tools.\n",
		);
		expect(checkHandWrittenDocs(root, facts)).toEqual([
			{
				file: `${DOCS}/guide.mdx`,
				line: 5,
				kind: "count",
				match: "99 MCP tools",
			},
		]);
	});

	test("generated pages are exempt: they are derived from the registries", () => {
		writeFileSync(
			join(root, DOCS, "reference", "commands.mdx"),
			"There are 28 commands in 1.8.1.\n",
		);
		writeFileSync(
			join(root, DOCS, "changelog.mdx"),
			"## 1.8.1\n\n- the `reviewCode` MCP tool\n",
		);
		expect(checkHandWrittenDocs(root, facts)).toEqual([]);
	});

	test("the repository's hand-written docs take their facts from facts.ts", () => {
		expect(checkHandWrittenDocs(REPO_ROOT, facts)).toEqual([]);
	});
});
