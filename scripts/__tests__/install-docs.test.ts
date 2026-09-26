/**
 * Install-first docs (#358, FR-DOC-2).
 *
 * The sidebar leads with Install, then Concepts, Guides, Reference,
 * Benchmarks and Changelog, and reaches every page. The install page has
 * one tab per way in (Claude Code, Cursor, Codex, CLI, Remote), each at
 * most three steps ending in a "verify it works" step, and the commands
 * each tab shows are the names the plugin generators actually publish.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { REDIRECTS, SIDEBAR } from "../../packages/docs/src/navigation";
import { DEFAULT_TOOLS } from "../../packages/mcp/src/allowlist";
import { PLUGIN } from "../../packages/plugins/src/definition";
import {
	CLAUDE_MARKETPLACE_PATH,
	CODEX_MARKETPLACE_PATH,
	CURSOR_MARKETPLACE_PATH,
	claudeMarketplace,
	codexMarketplace,
	cursorMarketplace,
} from "../../packages/plugins/src/generate/marketplace";
import { MCP_PATH } from "../../packages/remote/src/auth";
import { REMOTE_TOOLS } from "../../packages/remote/src/tools";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const DOCS = join(REPO_ROOT, "packages", "docs", "src", "content", "docs");
const INSTALL = join(DOCS, "install.mdx");

const readJson = (text: string): Record<string, unknown> =>
	JSON.parse(text) as Record<string, unknown>;

type SidebarItem = Readonly<{
	label?: string;
	slug?: string;
	items?: readonly SidebarItem[];
}>;

const slugsOf = (items: readonly SidebarItem[]): string[] =>
	items.flatMap((item) => [
		...(item.slug !== undefined ? [item.slug] : []),
		...slugsOf(item.items ?? []),
	]);

function pages(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) return pages(full);
		return /\.mdx?$/.test(name)
			? [
					relative(DOCS, full)
						.split(sep)
						.join("/")
						.replace(/\.mdx?$/, ""),
				]
			: [];
	});
}

describe("sidebar", () => {
	const sidebar = SIDEBAR as readonly SidebarItem[];

	test("is install-first: Install, Concepts, Guides, Reference, Benchmarks, Changelog", () => {
		expect(sidebar.map((group) => group.label)).toEqual([
			"Install",
			"Concepts",
			"Guides",
			"Reference",
			"Benchmarks",
			"Changelog",
		]);
		expect(slugsOf(sidebar)[0]).toBe("install");
	});

	test("every sidebar entry is a page, and every page is in the sidebar once", () => {
		const slugs = slugsOf(sidebar);
		expect(slugs.filter((slug, i) => slugs.indexOf(slug) !== i)).toEqual([]);
		expect([...slugs].sort()).toEqual(pages(DOCS).sort());
	});

	test("the old setup pages are gone and their URLs redirect to install", () => {
		expect(existsSync(join(DOCS, "getting-started.mdx"))).toBe(false);
		expect(existsSync(join(DOCS, "full-setup.mdx"))).toBe(false);
		for (const from of ["/getting-started", "/full-setup", "/quickstart"]) {
			expect(REDIRECTS[from]).toBe("/install/");
		}
	});
});

/** Each `<TabItem label="...">` body on the install page, by label. */
function installTabs(text: string): Map<string, string> {
	const tabs = new Map<string, string>();
	for (const m of text.matchAll(
		/<TabItem\s+label="([^"]+)"[^>]*>([\s\S]*?)<\/TabItem>/g,
	)) {
		tabs.set(m[1] ?? "", m[2] ?? "");
	}
	return tabs;
}

/** The top-level numbered steps inside a tab's `<Steps>`. */
function steps(tab: string): string[] {
	const inner = /<Steps>([\s\S]*?)<\/Steps>/.exec(tab)?.[1] ?? "";
	return inner
		.split(/\r?\n/)
		.filter((line) => /^\s{0,4}\d+\.\s/.test(line))
		.map((line) => line.trim());
}

/** Every command a tab shows: inline code and fenced lines. */
function commands(tab: string): string[] {
	const fenced = [...tab.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].flatMap((m) =>
		(m[1] ?? "")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("#")),
	);
	const prose = tab.replace(/```[a-z]*\n[\s\S]*?```/g, "");
	const inline = [...prose.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
	return [...fenced, ...inline];
}

describe("install page", () => {
	const text = existsSync(INSTALL) ? readFileSync(INSTALL, "utf-8") : "";
	const tabs = installTabs(text);
	const tab = (label: string): string => tabs.get(label) ?? "";

	test("has one tab per way in, in order", () => {
		expect([...tabs.keys()]).toEqual([
			"Claude Code",
			"Cursor",
			"Codex",
			"CLI",
			"Remote",
		]);
	});

	test("each tab is at most three steps and ends by verifying it works", () => {
		for (const [label, body] of tabs) {
			const list = steps(body);
			expect({ label, count: list.length > 0 && list.length <= 3 }).toEqual({
				label,
				count: true,
			});
			expect({ label, last: list.at(-1) }).toEqual({
				label,
				last: expect.stringMatching(/^\d+\.\s+\*\*Verify it works/),
			});
		}
	});

	test("each host's verify step calls a tool that host's server registers by default", () => {
		const registered: ReadonlyMap<string, readonly string[]> = new Map([
			["Claude Code", DEFAULT_TOOLS],
			["Cursor", DEFAULT_TOOLS],
			["Codex", DEFAULT_TOOLS],
			["Remote", REMOTE_TOOLS],
		]);
		for (const [label, tools] of registered) {
			const last = steps(tab(label)).at(-1) ?? "";
			const tool = /call maina's `([a-z_]+)` tool/.exec(last)?.[1];
			expect({ label, tool, registered: tools.includes(tool ?? "") }).toEqual({
				label,
				tool: expect.any(String),
				registered: true,
			});
		}
		expect(steps(tab("CLI")).at(-1)).toContain("`maina doctor`");
	});

	const repoSlug = new URL(PLUGIN.repository).pathname.replace(/^\/|\/$/g, "");

	test("Claude Code shows the marketplace and plugin the generator publishes", () => {
		const listing = readJson(claudeMarketplace(PLUGIN).content);
		const plugins = listing.plugins as readonly { name: string }[];
		const marketplace = listing.name as string;
		const plugin = plugins[0]?.name ?? "";
		expect(existsSync(join(REPO_ROOT, CLAUDE_MARKETPLACE_PATH))).toBe(true);

		const shown = commands(tab("Claude Code"));
		expect(shown).toContain(`/plugin marketplace add ${repoSlug}`);
		expect(shown).toContain(`/plugin install ${plugin}@${marketplace}`);
		for (const cmd of shown.filter((c) => c.startsWith("/plugin install "))) {
			expect(cmd).toBe(`/plugin install ${plugin}@${marketplace}`);
		}
		for (const cmd of shown.filter((c) =>
			c.startsWith("/plugin marketplace add "),
		)) {
			expect(cmd).toBe(`/plugin marketplace add ${repoSlug}`);
		}
	});

	test("Cursor names the listed plugin and the repo its marketplace lives in", () => {
		const listing = readJson(cursorMarketplace(PLUGIN).content);
		expect(existsSync(join(REPO_ROOT, CURSOR_MARKETPLACE_PATH))).toBe(true);
		const plugins = listing.plugins as readonly { name: string }[];
		expect(plugins[0]?.name).toBe(PLUGIN.name);
		const body = tab("Cursor");
		expect(body).toContain(`**${PLUGIN.displayName}**`);
		expect(commands(body)).toContain(PLUGIN.repository);
	});

	test("Codex names the marketplace repo and the listed plugin", () => {
		const listing = readJson(codexMarketplace(PLUGIN).content);
		expect(existsSync(join(REPO_ROOT, CODEX_MARKETPLACE_PATH))).toBe(true);
		const displayName = (listing.interface as { displayName: string })
			.displayName;
		const body = tab("Codex");
		expect(commands(body)).toContain(repoSlug);
		expect(commands(body)).toContain("/plugins");
		expect(body).toContain(`**${displayName}**`);
	});

	test("CLI installs the published CLI package and verifies with doctor", () => {
		const cli = readJson(
			readFileSync(join(REPO_ROOT, "packages", "cli", "package.json"), "utf-8"),
		);
		const shown = commands(tab("CLI"));
		expect(shown.some((c) => c.includes(cli.name as string))).toBe(true);
		expect(shown).toContain("maina setup");
		expect(shown).toContain("maina doctor");
	});

	test("Remote connects to the connector's MCP endpoint under the server's name", () => {
		const shown = commands(tab("Remote"));
		const url = shown.find((c) => /^https:\/\/\S+$/.test(c)) ?? "";
		expect(new URL(url).pathname).toBe(MCP_PATH);
		expect(shown).toContain(
			`claude mcp add --transport http ${PLUGIN.mcpServer} ${url}`,
		);
	});
});
