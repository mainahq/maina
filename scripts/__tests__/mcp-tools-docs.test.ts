/**
 * MCP tool lists in docs, skills and agent files (#465): generated blocks
 * are rendered from the MCP catalog, and the check fails on a stale block
 * or on any retired 1.x tool name.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEEPWIKI_TOOLS,
	DEFAULT_TOOLS,
	renderToolList,
} from "../../packages/mcp/src/catalog";
import { checkToolDocs, syncToolBlocks } from "../mcp-tools-docs";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const MD_BLOCK = (body: string) =>
	`# Tools\n\n<!-- maina:mcp-tools default table -->\n${body}<!-- /maina:mcp-tools -->\n\nAfter.\n`;

describe("syncToolBlocks", () => {
	test("fills a markdown block with the rendered tool list", () => {
		const result = syncToolBlocks(MD_BLOCK(""));
		expect(result.errors).toEqual([]);
		expect(result.blocks).toBe(1);
		expect(result.text).toBe(
			MD_BLOCK(`${renderToolList(DEFAULT_TOOLS, "table")}\n`),
		);
	});

	test("replaces a stale block and is idempotent", () => {
		const first = syncToolBlocks(MD_BLOCK("| `getContext` | old |\n"));
		expect(first.text).not.toContain("getContext");
		expect(syncToolBlocks(first.text).text).toBe(first.text);
	});

	test("supports MDX comment markers and the DeepWiki set", () => {
		const mdx =
			"Intro\n\n{/* maina:mcp-tools deepwiki list */}\n{/* /maina:mcp-tools */}\n";
		const result = syncToolBlocks(mdx);
		expect(result.errors).toEqual([]);
		expect(result.text).toBe(
			`Intro\n\n{/* maina:mcp-tools deepwiki list */}\n${renderToolList(DEEPWIKI_TOOLS, "list")}\n{/* /maina:mcp-tools */}\n`,
		);
	});

	test("reports an unknown set or format instead of guessing", () => {
		const result = syncToolBlocks(
			"<!-- maina:mcp-tools everything grid -->\n<!-- /maina:mcp-tools -->\n",
		);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("everything grid");
	});

	test("reports an unclosed block", () => {
		const result = syncToolBlocks("<!-- maina:mcp-tools default list -->\n");
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("not closed");
	});
});

describe("checkToolDocs", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "maina-mcp-tools-docs-"));
		mkdirSync(join(root, "packages", "skills", "demo"), { recursive: true });
		mkdirSync(join(root, "packages", "docs", "src", "content", "docs"), {
			recursive: true,
		});
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("flags a stale block and a retired tool name with its line", () => {
		writeFileSync(join(root, "README.md"), MD_BLOCK(""));
		writeFileSync(
			join(root, "packages", "skills", "demo", "SKILL.md"),
			"# Demo\n\nCall the `reviewCode` MCP tool.\n",
		);
		const result = checkToolDocs(root);
		expect(result.stale).toEqual(["README.md"]);
		expect(result.retired).toEqual([
			{ file: "packages/skills/demo/SKILL.md", line: 3, name: "reviewCode" },
		]);
	});

	test("a synced file with v1 names is clean", () => {
		writeFileSync(
			join(root, "packages", "docs", "src", "content", "docs", "mcp.mdx"),
			syncToolBlocks(MD_BLOCK("")).text,
		);
		const result = checkToolDocs(root);
		expect(result).toEqual({ stale: [], retired: [], errors: [] });
	});

	test("the repository's docs, skills and agent files are clean", () => {
		expect(checkToolDocs(REPO_ROOT)).toEqual({
			stale: [],
			retired: [],
			errors: [],
		});
	});
});
