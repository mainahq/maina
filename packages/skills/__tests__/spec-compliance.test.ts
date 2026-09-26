/**
 * The skills follow the Agent Skills spec (https://agentskills.io/specification)
 * and ship only through the plugins and `.agents/skills` (v1 task 9.6).
 *
 * - Every skill is a folder holding a `SKILL.md` whose YAML front matter has
 *   only the spec's fields: `name` (matching the folder, lowercase words
 *   joined by single hyphens, at most 64 characters), `description` (at most
 *   1024 characters), and the optional `license`, `compatibility` (at most
 *   500 characters), `metadata` (string to string) and `allowed-tools`. No
 *   `triggers`: hosts match a skill on its description.
 * - The skills are the v1 flows: gate, verify, spec, triage and graph.
 * - Every skill is in the plugin definition and in every generated host
 *   package, still valid after the generator rewrites its CLI references.
 * - Nothing copies skills into `.maina/skills` any more.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PLUGIN } from "../../plugins/src/definition";

const SKILLS_DIR = join(import.meta.dir, "..");
const PACKAGES_DIR = join(SKILLS_DIR, "..");
const PLUGIN_DIST = join(PACKAGES_DIR, "plugins", "dist");

const V1_FLOWS = ["gate", "graph", "spec", "triage", "verify"];

const ALLOWED_FIELDS = new Set([
	"name",
	"description",
	"license",
	"compatibility",
	"metadata",
	"allowed-tools",
]);

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Frontmatter = Readonly<Record<string, unknown>>;

/** The skill folders under `root`: directories that hold a `SKILL.md`. */
function skillFolders(root: string): string[] {
	return readdirSync(root, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((name) => existsSync(join(root, name, "SKILL.md")))
		.sort();
}

/** The YAML front matter of a `SKILL.md`, or `null` when it has none. */
function frontmatter(markdown: string): Frontmatter | null {
	const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
	if (!match) return null;
	const parsed: unknown = Bun.YAML.parse(match[1] ?? "");
	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		? (parsed as Frontmatter)
		: null;
}

/** What makes `markdown` in folder `folder` break the spec; empty when valid. */
function specViolations(folder: string, markdown: string): string[] {
	const fm = frontmatter(markdown);
	if (fm === null) return ["no YAML front matter"];
	const problems: string[] = [];
	for (const key of Object.keys(fm)) {
		if (!ALLOWED_FIELDS.has(key)) problems.push(`field not in spec: ${key}`);
	}
	const { name, description, compatibility, metadata } = fm;
	if (name !== folder) problems.push(`name ${String(name)} != ${folder}`);
	if (typeof name !== "string" || !NAME.test(name) || name.length > 64) {
		problems.push(`invalid name: ${String(name)}`);
	}
	if (
		typeof description !== "string" ||
		description.trim().length === 0 ||
		description.length > 1024
	) {
		problems.push("description must be 1-1024 characters");
	}
	if (
		compatibility !== undefined &&
		(typeof compatibility !== "string" ||
			compatibility.length === 0 ||
			compatibility.length > 500)
	) {
		problems.push("compatibility must be 1-500 characters");
	}
	if (
		metadata !== undefined &&
		(typeof metadata !== "object" ||
			metadata === null ||
			Object.values(metadata).some((v) => typeof v !== "string"))
	) {
		problems.push("metadata must map strings to strings");
	}
	const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
	if (body.length === 0) problems.push("empty body");
	return problems;
}

const SKILLS = skillFolders(SKILLS_DIR);
const read = (name: string) =>
	readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf-8");

describe("Agent Skills spec", () => {
	test("the skills are the v1 flows", () => {
		expect(SKILLS).toEqual(V1_FLOWS);
	});

	for (const name of SKILLS) {
		test(`${name} validates`, () => {
			expect(specViolations(name, read(name))).toEqual([]);
		});

		test(`${name} carries maina's ownership marker`, () => {
			// `maina setup` refreshes a skill in `.agents/skills` only when the
			// copy there carries this marker, so it never clobbers a user's own.
			const fm = frontmatter(read(name));
			expect((fm?.metadata as Record<string, string>)?.author).toBe("mainahq");
		});
	}

	test("the validator rejects each violation", () => {
		const ok = "---\nname: demo\ndescription: Does a thing.\n---\n\nBody.\n";
		expect(specViolations("demo", ok)).toEqual([]);
		expect(specViolations("other", ok)).toContain("name demo != other");
		expect(specViolations("demo", "# no front matter\n")).toEqual([
			"no YAML front matter",
		]);
		expect(
			specViolations(
				"demo",
				'---\nname: demo\ndescription: x\ntriggers:\n  - "go"\n---\n\nB\n',
			),
		).toContain("field not in spec: triggers");
		expect(
			specViolations(
				"demo",
				`---\nname: demo\ndescription: ${"a".repeat(1025)}\n---\n\nB\n`,
			),
		).toContain("description must be 1-1024 characters");
		expect(
			specViolations(
				"Demo--x",
				"---\nname: Demo--x\ndescription: x\n---\n\nB\n",
			),
		).toContain("invalid name: Demo--x");
	});
});

describe("shipped only through plugins or .agents/skills", () => {
	test("the plugin definition ships every skill", () => {
		expect([...PLUGIN.skills].sort()).toEqual(SKILLS);
	});

	const hosts = existsSync(PLUGIN_DIST)
		? readdirSync(PLUGIN_DIST, { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.map((e) => e.name)
		: [];

	test("there are generated host packages", () => {
		expect(hosts.length).toBeGreaterThan(0);
	});

	for (const host of hosts) {
		test(`${host}: ships exactly the skills, each still valid`, () => {
			const dir = join(PLUGIN_DIST, host, "skills");
			expect(skillFolders(dir)).toEqual(SKILLS);
			for (const name of SKILLS) {
				const markdown = readFileSync(join(dir, name, "SKILL.md"), "utf-8");
				expect(specViolations(name, markdown)).toEqual([]);
			}
		});
	}

	test("nothing copies skills into .maina/skills", () => {
		const roots = [
			join(PACKAGES_DIR, "cli", "src"),
			join(PACKAGES_DIR, "core", "src"),
			join(PACKAGES_DIR, "runtime", "src"),
			join(PACKAGES_DIR, "mcp", "src"),
			join(PACKAGES_DIR, "plugins", "src"),
			join(PACKAGES_DIR, "docs", "src", "content", "docs"),
		];
		const offenders = roots.flatMap((root) =>
			[...new Bun.Glob("**/*.{ts,md,mdx}").scanSync({ cwd: root })]
				.filter((path) => !path.includes("__golden__"))
				.filter((path) =>
					readFileSync(join(root, path), "utf-8").includes(".maina/skills"),
				)
				.map((path) => relative(PACKAGES_DIR, join(root, path))),
		);
		expect(offenders).toEqual([]);
	});
});
