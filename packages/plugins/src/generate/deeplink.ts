/**
 * The Cursor MCP-only fallback (v1 task 9.3). Pure: no I/O.
 *
 * For a team that cannot install the Cursor plugin, an MCP install deeplink
 * (https://cursor.com/docs/context/mcp/install-links) adds the maina MCP
 * server and nothing else: no hooks, so no gate. The docs page renders it
 * from the data file this writes, so the link and the server it installs
 * move with each release.
 *
 * The server is the CLI's portable entry, `npx @mainahq/cli@<version>
 * --mcp`: a link cannot know where bun or maina sit on the machine that
 * opens it. It is the form `maina mcp add` writes when nothing resolves,
 * pinned at the plugin's version (the runtime's, which the CLI release
 * shares), and `maina mcp add --client cursor` replaces it with absolute
 * paths where a stripped GUI PATH has no npx.
 */

import type { PluginDefinition } from "../definition";
import { file, json } from "./shared";
import type { GeneratedFile } from "./types";

/** Where the docs site reads the link, from the repo root. */
export const CURSOR_MCP_INSTALL_PATH =
	"packages/docs/src/data/cursor-mcp-install.json";

type McpServer = Readonly<{ command: string; args: readonly string[] }>;

/** The CLI as a stdio MCP server, pinned at `version`. */
export const mcpOnlyServer = (version: string): McpServer => ({
	command: "npx",
	args: [`@mainahq/cli@${version}`, "--mcp"],
});

/**
 * Cursor's MCP install link: `name`, and `config` as the server's JSON
 * config in base64, percent-encoded so `+`, `/` and `=` survive a query
 * string.
 */
export function cursorMcpDeeplink(name: string, server: McpServer): string {
	const config = Buffer.from(JSON.stringify(server), "utf-8").toString(
		"base64",
	);
	return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
}

/** The docs data: the server's name, its config and the link that adds it. */
export function cursorMcpInstall(
	definition: PluginDefinition,
	version: string,
): GeneratedFile {
	const server = mcpOnlyServer(version);
	return file(
		CURSOR_MCP_INSTALL_PATH,
		json({
			name: definition.mcpServer,
			server,
			deeplink: cursorMcpDeeplink(definition.mcpServer, server),
		}),
	);
}
