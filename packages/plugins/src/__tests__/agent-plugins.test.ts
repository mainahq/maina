/**
 * The Agent Plugins 1.0 package (v1 task 9.5, spec §5), read by VS Code
 * agent mode and Copilot. `generate.test.ts` validates its two JSON files
 * against the pinned 1.0 schemas; these pin the rest of what the
 * specification (https://agent-plugins.org/specification) requires for a
 * client to load it:
 *
 *   - each file names the canonical schema a client selects it by
 *   - components sit only in their fixed locations: `plugin.json`,
 *     `mcp.json` and immediate `skills/<name>/SKILL.md` folders
 *   - every path stays inside the plugin root, including the launcher path
 *     each skill gives relative to its folder
 *   - the MCP server is one plugin-relative, executable token the client
 *     resolves against the plugin root, with the variables the client
 *     supplies left to the client
 *   - the version is SemVer, the one the launcher pins
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { PLUGIN } from "../definition";
import { type GeneratedFile, generate } from "../generate";
import { loadSources } from "../sources";

const SCHEMAS = join(import.meta.dir, "..", "__fixtures__", "agent-plugins");

const loaded = loadSources();
if (!loaded.ok) throw new Error(loaded.error);
const sources = loaded.value;
const files: readonly GeneratedFile[] = generate("agent-plugins", sources);
const paths = files.map((f) => f.path);

const contentOf = (path: string): string => {
	const file = files.find((f) => f.path === path);
	if (file === undefined) throw new Error(`no ${path}`);
	return file.content;
};

const jsonOf = (path: string) =>
	JSON.parse(contentOf(path)) as Record<string, unknown>;

const schemaId = (name: string): string =>
	(
		JSON.parse(readFileSync(join(SCHEMAS, "schemas", name), "utf-8")) as {
			$id: string;
		}
	).$id;

type StdioServer = {
	type: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
};

const server = (): StdioServer =>
	(jsonOf("mcp.json").mcpServers as Record<string, StdioServer>)[
		PLUGIN.mcpServer
	] as StdioServer;

/** A path from the plugin root that stays inside it, or null. */
function insideRoot(from: string, relativePath: string): string | null {
	const joined = posix.normalize(posix.join(from, relativePath));
	return joined === ".." || joined.startsWith("../") || posix.isAbsolute(joined)
		? null
		: joined;
}

describe("Agent Plugins 1.0 package", () => {
	test("each file names the canonical 1.0 schema a client selects it by", () => {
		expect(jsonOf("plugin.json").$schema).toBe(schemaId("plugin.schema.json"));
		expect(jsonOf("mcp.json").$schema).toBe(schemaId("mcp.schema.json"));
		expect(schemaId("plugin.schema.json")).toBe(
			"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
		);
	});

	test("components sit only in their fixed locations", () => {
		const top = [...new Set(paths.map((p) => p.split("/")[0]))].sort();
		// launcher/ is a supporting folder the MCP server and skills name.
		expect(top).toEqual(["launcher", "mcp.json", "plugin.json", "skills"]);
		const skills = paths.filter((p) => p.startsWith("skills/"));
		for (const path of skills)
			expect(path).toMatch(/^skills\/[^/]+\/SKILL\.md$/);
		expect(skills.map((p) => p.split("/")[1]).sort()).toEqual(
			[...PLUGIN.skills].sort(),
		);
	});

	test("every path stays inside the plugin root", () => {
		for (const path of paths) {
			expect(path).not.toContain("\\");
			expect(insideRoot(".", path)).toBe(path);
		}
	});

	test("the launcher each skill names, relative to its folder, is in the package", () => {
		for (const name of PLUGIN.skills) {
			const skill = contentOf(`skills/${name}/SKILL.md`);
			const referenced = [...skill.matchAll(/`(\.\.\/[^\s`]+)/g)].map(
				(m) => m[1] ?? "",
			);
			expect(referenced.length).toBeGreaterThan(0);
			for (const ref of referenced) {
				const target = insideRoot(`skills/${name}`, ref);
				expect(target).toBe("launcher/launch.sh");
				expect(paths).toContain(target ?? "");
			}
		}
	});

	test("the MCP server is one plugin-relative, executable token the client resolves against the plugin root", () => {
		const { type, command, env, cwd } = server();
		expect(type).toBe("stdio");
		// A single token: the client neither splits it nor expands it.
		expect(command).toMatch(/^\.\/\S+$/);
		expect(command).not.toContain("${");
		const target = insideRoot(".", command);
		expect(target).not.toBeNull();
		expect(files.find((f) => f.path === target)?.executable).toBe(true);
		// The default working directory, the plugin root, is where it runs.
		expect(cwd).toBeUndefined();
		// The client supplies PLUGIN_ROOT and PLUGIN_DATA; the package may not.
		expect(Object.keys(env ?? {})).not.toContain("PLUGIN_ROOT");
		expect(Object.keys(env ?? {})).not.toContain("PLUGIN_DATA");
	});

	test("the version is SemVer, the one the launcher pins", () => {
		const version = jsonOf("plugin.json").version;
		expect(version).toBe(sources.version);
		expect(version).toMatch(
			/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
		);
	});
});
