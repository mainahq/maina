/**
 * The Cursor MCP-only fallback (v1 task 9.3): an MCP install deeplink for
 * teams that cannot install the plugin. It adds the maina MCP server and
 * nothing else (no hooks, so no gate), which the docs page says.
 *
 * Cursor's format (https://cursor.com/docs/context/mcp/install-links):
 * `cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<base64
 * of the server's JSON config>`. These tests pin the link, the server it
 * installs (the CLI's own portable entry, pinned at the plugin's version)
 * and that the committed docs data is what the generator writes.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN } from "../definition";
import {
	CURSOR_MCP_INSTALL_PATH,
	cursorMcpDeeplink,
	cursorMcpInstall,
	mcpOnlyServer,
} from "../generate/deeplink";
import { loadSources } from "../sources";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const DOCS_PAGE = join(
	REPO_ROOT,
	"packages",
	"docs",
	"src",
	"content",
	"docs",
	"cursor.mdx",
);

const loaded = loadSources();
if (!loaded.ok) throw new Error(loaded.error);
const { version } = loaded.value;

type Install = Readonly<{
	name: string;
	server: Readonly<{ command: string; args: readonly string[] }>;
	deeplink: string;
}>;

const install = (): Install =>
	JSON.parse(cursorMcpInstall(PLUGIN, version).content) as Install;

describe("Cursor MCP install deeplink", () => {
	test("is Cursor's MCP install link, named after the plugin's MCP server", () => {
		const url = new URL(cursorMcpDeeplink("maina", mcpOnlyServer(version)));
		expect(url.protocol).toBe("cursor:");
		expect(url.host).toBe("anysphere.cursor-deeplink");
		expect(url.pathname).toBe("/mcp/install");
		expect(url.searchParams.get("name")).toBe("maina");
	});

	test("config is the server's JSON config, base64, safe in a query string", () => {
		const server = mcpOnlyServer(version);
		const link = cursorMcpDeeplink("maina", server);
		const raw = /[?&]config=([^&]*)/.exec(link)?.[1] ?? "";
		// `+`, `/` and `=` are escaped, so no parser turns `+` into a space.
		expect(raw).toMatch(/^[A-Za-z0-9%]+$/);
		const config = new URL(link).searchParams.get("config") ?? "";
		expect(JSON.parse(atob(config))).toEqual(server);
	});

	test("installs the CLI's portable MCP entry, pinned at the plugin's version", () => {
		// The form `maina mcp add` writes when nothing resolves on PATH, and
		// one `maina doctor` recognises as maina's own launcher.
		expect(mcpOnlyServer(version)).toEqual({
			command: "npx",
			args: [`@mainahq/cli@${version}`, "--mcp"],
		});
		expect(version).toMatch(/^\d+\.\d+\.\d+/);
	});

	test("the docs data carries the name, the server and the link", () => {
		const data = install();
		expect(data.name).toBe(PLUGIN.mcpServer);
		expect(data.server).toEqual(mcpOnlyServer(version));
		expect(data.deeplink).toBe(
			cursorMcpDeeplink(PLUGIN.mcpServer, mcpOnlyServer(version)),
		);
	});

	test("the committed docs data is what the generator writes (run `bun run plugins:generate`)", () => {
		expect(CURSOR_MCP_INSTALL_PATH).toBe(
			"packages/docs/src/data/cursor-mcp-install.json",
		);
		const path = join(REPO_ROOT, CURSOR_MCP_INSTALL_PATH);
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, "utf-8")).toBe(
			cursorMcpInstall(PLUGIN, version).content,
		);
	});

	test("the Cursor docs page offers the link from the generated data", () => {
		expect(existsSync(DOCS_PAGE)).toBe(true);
		const page = readFileSync(DOCS_PAGE, "utf-8");
		expect(page).toContain("data/cursor-mcp-install.json");
		expect(page).toMatch(/href=\{install\.deeplink\}/);
	});
});
