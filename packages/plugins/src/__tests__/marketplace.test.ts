/**
 * The Claude Code (v1 task 9.2) and Cursor (task 9.3) marketplaces, spec §5.
 *
 * `/plugin marketplace add mainahq/maina` clones this repo and reads
 * `.claude-plugin/marketplace.json` at its root; `/plugin install
 * maina@maina` then copies the plugin its entry points at. These tests pin:
 *
 *   - the listing validates against the documented marketplace schema,
 *     pinned under `../__fixtures__/claude/schemas/`
 *   - it lists `maina`, whose relative source is the generated Claude Code
 *     package, and that package is the same plugin (name, description)
 *   - the version lives only in the plugin's own manifest, so the listing
 *     never pins a version the package does not have
 *   - the committed listing is what the generator writes
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { PLUGIN } from "../definition";
import { generate } from "../generate";
import {
	CLAUDE_MARKETPLACE_PATH,
	CLAUDE_PLUGIN_SOURCE,
	CODEX_MARKETPLACE_PATH,
	CODEX_PLUGIN_SOURCE,
	CURSOR_MARKETPLACE_PATH,
	CURSOR_PLUGIN_SOURCE,
	claudeMarketplace,
	codexMarketplace,
	cursorMarketplace,
} from "../generate/marketplace";
import { loadSources } from "../sources";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SCHEMA = join(
	import.meta.dir,
	"..",
	"__fixtures__",
	"claude",
	"schemas",
	"marketplace.schema.json",
);

const loaded = loadSources();
if (!loaded.ok) throw new Error(loaded.error);
const sources = loaded.value;

const readJson = (path: string): unknown =>
	JSON.parse(readFileSync(path, "utf-8"));

type Entry = Readonly<{
	name: string;
	source: string;
	description?: string;
	version?: string;
}>;
type Listing = Readonly<{
	name: string;
	owner: { name: string };
	plugins: readonly Entry[];
}>;

const listing = (): Listing =>
	JSON.parse(claudeMarketplace(PLUGIN).content) as Listing;

function validator() {
	const ajv = new Ajv2020({ allErrors: true, strict: true });
	ajv.addKeyword({ keyword: "x-source" });
	return ajv.compile(readJson(SCHEMA) as object);
}

describe("Claude Code marketplace", () => {
	test("sits where Claude Code reads it: .claude-plugin/marketplace.json at the repo root", () => {
		expect(CLAUDE_MARKETPLACE_PATH).toBe(".claude-plugin/marketplace.json");
		expect(claudeMarketplace(PLUGIN).path).toBe(CLAUDE_MARKETPLACE_PATH);
	});

	test("validates against the documented marketplace schema", () => {
		const validate = validator();
		const ok = validate(listing());
		expect(validate.errors ?? []).toEqual([]);
		expect(ok).toBe(true);
	});

	test("lists maina, installed as maina@maina", () => {
		const { name, plugins } = listing();
		expect(name).toBe(PLUGIN.name);
		expect(plugins.map((p) => p.name)).toEqual([PLUGIN.name]);
	});

	test("the entry's source is the generated Claude Code package, which is the same plugin", () => {
		const [entry] = listing().plugins;
		expect(entry?.source).toBe(CLAUDE_PLUGIN_SOURCE);
		const dir = join(REPO_ROOT, CLAUDE_PLUGIN_SOURCE);
		const manifest = readJson(join(dir, ".claude-plugin", "plugin.json")) as {
			name: string;
			description: string;
		};
		expect(manifest.name).toBe(entry?.name ?? "");
		expect(entry?.description).toBe(manifest.description);
		// The installed copy is self-contained: hooks, MCP and the launcher.
		for (const path of [
			"hooks/hooks.json",
			".mcp.json",
			"launcher/launch.sh",
		]) {
			expect(existsSync(join(dir, path))).toBe(true);
		}
	});

	test("pins no version: the plugin's manifest is the only one", () => {
		// Claude Code silently prefers plugin.json when both set one, so a
		// second copy could only drift.
		expect(listing().plugins[0]?.version).toBeUndefined();
		const manifest = JSON.parse(
			generate("claude", sources).find(
				(f) => f.path === ".claude-plugin/plugin.json",
			)?.content ?? "{}",
		) as { version?: string };
		expect(manifest.version).toBe(sources.version);
	});

	test("the schema refuses a source outside the marketplace or a reserved name", () => {
		const validate = validator();
		const base = listing();
		const entry = base.plugins[0] as Entry;
		expect(
			validate({ ...base, plugins: [{ ...entry, source: "../elsewhere" }] }),
		).toBe(false);
		expect(
			validate({ ...base, plugins: [{ ...entry, source: "./a/../../b" }] }),
		).toBe(false);
		expect(validate({ ...base, name: "claude-plugins-official" })).toBe(false);
		expect(validate({ ...base, owner: undefined })).toBe(false);
	});

	test("the committed listing is what the generator writes (run `bun run plugins:generate`)", () => {
		const path = join(REPO_ROOT, CLAUDE_MARKETPLACE_PATH);
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, "utf-8")).toBe(claudeMarketplace(PLUGIN).content);
	});
});

// ── Cursor (v1 task 9.3) ───────────────────────────────────────────────────

const CURSOR_SCHEMA = join(
	import.meta.dir,
	"..",
	"__fixtures__",
	"cursor",
	"schemas",
	"marketplace.schema.json",
);

const cursorListing = (): Listing =>
	JSON.parse(cursorMarketplace(PLUGIN).content) as Listing;

function cursorValidator() {
	const ajv = new Ajv2020({ allErrors: true, strict: true });
	ajv.addKeyword({ keyword: "x-source" });
	return ajv.compile(readJson(CURSOR_SCHEMA) as object);
}

/**
 * The same repo is the listing for the Cursor Marketplace submission and a
 * Team Marketplace: Dashboard, Plugins & MCPs, Import from Repo reads
 * `.cursor-plugin/marketplace.json` at its root.
 */
describe("Cursor marketplace", () => {
	test("sits where Cursor reads it: .cursor-plugin/marketplace.json at the repo root", () => {
		expect(CURSOR_MARKETPLACE_PATH).toBe(".cursor-plugin/marketplace.json");
		expect(cursorMarketplace(PLUGIN).path).toBe(CURSOR_MARKETPLACE_PATH);
	});

	test("validates against the documented marketplace schema", () => {
		const validate = cursorValidator();
		const ok = validate(cursorListing());
		expect(validate.errors ?? []).toEqual([]);
		expect(ok).toBe(true);
	});

	test("lists maina, from the generated Cursor package, which is the same plugin", () => {
		const { name, plugins } = cursorListing();
		expect(name).toBe(PLUGIN.name);
		expect(plugins.map((p) => p.name)).toEqual([PLUGIN.name]);
		const [entry] = plugins;
		expect(entry?.source).toBe(CURSOR_PLUGIN_SOURCE);
		const dir = join(REPO_ROOT, CURSOR_PLUGIN_SOURCE);
		const manifest = readJson(join(dir, ".cursor-plugin", "plugin.json")) as {
			name: string;
			description: string;
		};
		expect(manifest.name).toBe(entry?.name ?? "");
		expect(entry?.description).toBe(manifest.description);
		for (const path of [
			"hooks/hooks.json",
			"mcp.json",
			"rules/maina.mdc",
			"launcher/launch.sh",
		]) {
			expect(existsSync(join(dir, path))).toBe(true);
		}
	});

	test("pins no version: the plugin's manifest is the only one", () => {
		expect(cursorListing().plugins[0]?.version).toBeUndefined();
	});

	test("the committed listing is what the generator writes (run `bun run plugins:generate`)", () => {
		const path = join(REPO_ROOT, CURSOR_MARKETPLACE_PATH);
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, "utf-8")).toBe(cursorMarketplace(PLUGIN).content);
	});
});

// ── Codex (v1 task 9.4) ────────────────────────────────────────────────────

const CODEX_SCHEMA = join(
	import.meta.dir,
	"..",
	"__fixtures__",
	"codex",
	"schemas",
	"marketplace.schema.json",
);

type CodexEntry = Readonly<{
	name: string;
	source: { source: string; path: string };
	policy?: { installation?: string; authentication?: string };
	category?: string;
	version?: string;
}>;
type CodexListing = Readonly<{
	name: string;
	interface?: { displayName?: string };
	plugins: readonly CodexEntry[];
}>;

const codexListing = (): CodexListing =>
	JSON.parse(codexMarketplace(PLUGIN).content) as CodexListing;

function codexValidator() {
	const ajv = new Ajv2020({ allErrors: true, strict: true });
	ajv.addKeyword({ keyword: "x-source" });
	return ajv.compile(readJson(CODEX_SCHEMA) as object);
}

/**
 * Codex reads a repo's marketplace from `.agents/plugins/marketplace.json`
 * at its root; each entry's `source` is a local folder, relative to that
 * root, which `/plugins` installs from.
 */
describe("Codex marketplace", () => {
	test("sits where Codex reads it: .agents/plugins/marketplace.json at the repo root", () => {
		expect(CODEX_MARKETPLACE_PATH).toBe(".agents/plugins/marketplace.json");
		expect(codexMarketplace(PLUGIN).path).toBe(CODEX_MARKETPLACE_PATH);
	});

	test("validates against the documented marketplace schema", () => {
		const validate = codexValidator();
		const ok = validate(codexListing());
		expect(validate.errors ?? []).toEqual([]);
		expect(ok).toBe(true);
	});

	test("lists maina, from the generated Codex package, which is the same plugin", () => {
		const { name, plugins } = codexListing();
		expect(name).toBe(PLUGIN.name);
		expect(plugins.map((p) => p.name)).toEqual([PLUGIN.name]);
		const [entry] = plugins;
		expect(entry?.source).toEqual({
			source: "local",
			path: CODEX_PLUGIN_SOURCE,
		});
		const dir = join(REPO_ROOT, CODEX_PLUGIN_SOURCE);
		const manifest = readJson(join(dir, "plugin.json")) as {
			name: string;
			extensions: { "com.openai": { interface: { category: string } } };
		};
		expect(manifest.name).toBe(entry?.name ?? "");
		expect(entry?.category).toBe(
			manifest.extensions["com.openai"].interface.category,
		);
		// The installed copy is self-contained: hooks, MCP, the command
		// policy and the launcher.
		for (const path of [
			"hooks/hooks.json",
			"mcp.json",
			"rules/maina.rules",
			"launcher/launch.sh",
		]) {
			expect(existsSync(join(dir, path))).toBe(true);
		}
	});

	test("users choose to install it, and it needs no sign-in", () => {
		expect(codexListing().plugins[0]?.policy).toEqual({
			installation: "AVAILABLE",
			authentication: "ON_INSTALL",
		});
	});

	test("pins no version: the plugin's manifest is the only one", () => {
		expect(codexListing().plugins[0]?.version).toBeUndefined();
	});

	test("the schema refuses a source outside the marketplace", () => {
		const validate = codexValidator();
		const base = codexListing();
		const entry = base.plugins[0] as CodexEntry;
		for (const path of ["../elsewhere", "./a/../../b", "packages/x", "/abs"]) {
			expect(
				validate({
					...base,
					plugins: [{ ...entry, source: { source: "local", path } }],
				}),
			).toBe(false);
		}
	});

	test("the committed listing is what the generator writes (run `bun run plugins:generate`)", () => {
		const path = join(REPO_ROOT, CODEX_MARKETPLACE_PATH);
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, "utf-8")).toBe(codexMarketplace(PLUGIN).content);
	});
});
