/**
 * The Claude Code marketplace (v1 task 9.2, spec §5).
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
	claudeMarketplace,
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
