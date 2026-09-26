#!/usr/bin/env bun
/**
 * MCP tool lists in docs, skills and agent files (#465).
 *
 * The tool names agents are told to call come from one place, the MCP
 * catalog (`packages/mcp/src/catalog.ts`). Markdown cannot import it, so a
 * doc marks where its tool list goes and this script renders it:
 *
 *     <!-- maina:mcp-tools default table -->
 *     <!-- /maina:mcp-tools -->
 *
 * (`{/* maina:mcp-tools default table *\/}` ... `{/* /maina:mcp-tools *\/}`
 * in MDX). The set is `default`, `deepwiki` or `all`; the format is `list`
 * or `table`.
 *
 *   bun scripts/mcp-tools-docs.ts           rewrite every block in place
 *   bun scripts/mcp-tools-docs.ts --check   fail on a stale block, or on a
 *                                           retired 1.x tool name anywhere
 *                                           in the scanned files
 *
 * Scanned: README.md, .github/copilot-instructions.md, every skill's
 * SKILL.md, the docs site's content, and the `maina setup` agent-file
 * templates.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
	ALL_TOOLS,
	DEEPWIKI_TOOLS,
	DEFAULT_TOOLS,
	findRetiredTools,
	renderToolList,
	type ToolListFormat,
	type ToolName,
} from "../packages/mcp/src/catalog";

const ROOT = join(import.meta.dir, "..");

const SETS: Readonly<Record<string, readonly ToolName[]>> = {
	default: DEFAULT_TOOLS,
	deepwiki: DEEPWIKI_TOOLS,
	all: ALL_TOOLS,
};

const FORMATS: readonly ToolListFormat[] = ["list", "table"];

/** An opening marker, as an HTML or an MDX comment, alone on its line. */
const OPEN =
	/^(?:<!--\s*maina:mcp-tools\s+([^>]*?)\s*-->|\{\/\*\s*maina:mcp-tools\s+(.*?)\s*\*\/\})[ \t]*$/;
const CLOSE =
	/^(?:<!--\s*\/maina:mcp-tools\s*-->|\{\/\*\s*\/maina:mcp-tools\s*\*\/\})[ \t]*$/;

export interface SyncResult {
	text: string;
	blocks: number;
	errors: string[];
}

/**
 * `text` with every tool block re-rendered from the catalog. Line endings
 * are kept: a CRLF file (a Windows checkout) stays CRLF, so its markers are
 * still found and a synced file is not reported stale.
 */
export function syncToolBlocks(text: string): SyncResult {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const out: string[] = [];
	const errors: string[] = [];
	let blocks = 0;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		const open = OPEN.exec(line);
		out.push(line);
		i++;
		if (!open) continue;
		const spec = (open[1] ?? open[2] ?? "").trim();
		const end = lines.findIndex((l, j) => j >= i && CLOSE.test(l));
		if (end < 0) {
			errors.push(`line ${i}: mcp-tools block "${spec}" is not closed`);
			continue;
		}
		const [setName = "", format = "", ...rest] = spec.split(/\s+/);
		const tools = SETS[setName];
		const fmt = FORMATS.find((f) => f === format);
		if (!tools || !fmt || rest.length > 0) {
			errors.push(
				`line ${i}: unknown mcp-tools block "${spec}" (want <${Object.keys(SETS).join("|")}> <${FORMATS.join("|")}>)`,
			);
			out.push(...lines.slice(i, end));
		} else {
			out.push(...renderToolList(tools, fmt).split("\n"));
			blocks++;
		}
		out.push(lines[end] ?? "");
		i = end + 1;
	}
	return { text: out.join(eol), blocks, errors };
}

export interface RetiredHit {
	file: string;
	line: number;
	name: string;
}

export interface CheckResult {
	/** Files whose tool blocks differ from the catalog. */
	stale: string[];
	/** Retired tool names, by file and line. */
	retired: RetiredHit[];
	/** Malformed blocks. */
	errors: string[];
}

function listFiles(dir: string, keep: (name: string) => boolean): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir).sort();
	} catch {
		return [];
	}
	return entries.flatMap((name) => {
		const full = join(dir, name);
		try {
			if (statSync(full).isDirectory()) return listFiles(full, keep);
		} catch {
			return [];
		}
		return keep(name) ? [full] : [];
	});
}

/** The files under `root` whose MCP tool names this script owns. */
function targets(root: string): string[] {
	const skills = listFiles(
		join(root, "packages", "skills"),
		(n) => n === "SKILL.md",
	).filter((f) => !f.includes(`${sep}node_modules${sep}`));
	const docs = listFiles(
		join(root, "packages", "docs", "src", "content", "docs"),
		(n) => n.endsWith(".md") || n.endsWith(".mdx"),
	);
	const agentFiles = listFiles(
		join(root, "packages", "cli", "src", "onboarding", "setup", "agent-files"),
		(n) => n.endsWith(".ts") && !n.endsWith(".test.ts"),
	).filter((f) => !f.includes(`${sep}__tests__${sep}`));
	return [
		join(root, "README.md"),
		join(root, ".github", "copilot-instructions.md"),
		...skills,
		...docs,
		...agentFiles,
	];
}

function read(file: string): string | undefined {
	try {
		return readFileSync(file, "utf-8");
	} catch {
		return undefined;
	}
}

/** Stale blocks and retired tool names in the files under `root`. */
export function checkToolDocs(root: string): CheckResult {
	const result: CheckResult = { stale: [], retired: [], errors: [] };
	for (const file of targets(root)) {
		const body = read(file);
		if (body === undefined) continue;
		const rel = relative(root, file).split(sep).join("/");
		const synced = syncToolBlocks(body);
		if (synced.text !== body) result.stale.push(rel);
		result.errors.push(...synced.errors.map((e) => `${rel}: ${e}`));
		body.split("\n").forEach((line, i) => {
			for (const name of findRetiredTools(line)) {
				result.retired.push({ file: rel, line: i + 1, name });
			}
		});
	}
	return result;
}

/** Rewrites every stale block under `root`; returns the files written. */
function writeToolDocs(root: string): Readonly<{
	written: string[];
	errors: string[];
}> {
	const written: string[] = [];
	const errors: string[] = [];
	for (const file of targets(root)) {
		const body = read(file);
		if (body === undefined) continue;
		const rel = relative(root, file).split(sep).join("/");
		const synced = syncToolBlocks(body);
		errors.push(...synced.errors.map((e) => `${rel}: ${e}`));
		if (synced.text === body) continue;
		writeFileSync(file, synced.text, "utf-8");
		written.push(rel);
	}
	return { written, errors };
}

function main(): number {
	if (process.argv.includes("--check")) {
		const { stale, retired, errors } = checkToolDocs(ROOT);
		if (stale.length + retired.length + errors.length === 0) {
			console.log("mcp-tools-docs --check: OK");
			return 0;
		}
		console.error("mcp-tools-docs --check: FAIL");
		for (const f of stale) {
			console.error(`  ${f}: tool list is stale`);
		}
		for (const h of retired) {
			console.error(`  ${h.file}:${h.line}: retired MCP tool \`${h.name}\``);
		}
		for (const e of errors) console.error(`  ${e}`);
		console.error(
			`\nFix: run \`bun run docs:tools\` and name only v1 tools (${ALL_TOOLS.join(", ")}).`,
		);
		return 1;
	}
	const { written, errors } = writeToolDocs(ROOT);
	for (const f of written) console.log(`updated ${f}`);
	for (const e of errors) console.error(e);
	return errors.length > 0 ? 1 : 0;
}

if (import.meta.main) {
	process.exit(main());
}
