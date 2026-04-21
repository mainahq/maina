#!/usr/bin/env bun
/**
 * Wave 4 / G11 — build-time SSOT for "how many commands, MCP tools,
 * skills does maina ship?".
 *
 * Two modes:
 *
 *   bun scripts/docs-manifest.ts
 *     Emit a JSON manifest on stdout. Used for docs/landing copy
 *     generation — never hand-typed.
 *
 *   bun scripts/docs-manifest.ts --check
 *     Grep README.md and packages/docs/src/content/docs/**.md{,x} for
 *     hand-typed `N commands` / `N MCP tools` / `N skills` patterns.
 *     Fail with exit 1 and a pointer to the manifest if any match.
 *
 * The number-extractor is a simple regex; prose like "nine commands"
 * (spelled-out number) does not match, so legitimate text is safe.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

// ── Sources of truth ────────────────────────────────────────────────────────

function countVisibleCommands(): number {
	const path = join(ROOT, "packages", "cli", "src", "program.ts");
	const body = readFileSync(path, "utf-8");

	// Everything between `// ── Workflow` (first block) and
	// `// ── Internals` is user-facing.
	const start = body.indexOf("// ── Workflow");
	const end = body.indexOf("// ── Internals");
	if (start < 0 || end < 0 || end <= start) {
		throw new Error(
			"docs-manifest: could not locate Workflow/Internals section markers in program.ts",
		);
	}
	const visible = body.slice(start, end);
	const matches = visible.match(/program\.addCommand\(/g) ?? [];
	return matches.length;
}

function countMcpTools(): number {
	const path = join(ROOT, "packages", "mcp", "src", "server.ts");
	const body = readFileSync(path, "utf-8");
	// `ALL_TOOL_DESCRIPTIONS` is the canonical list. We parse the array
	// literal length by counting occurrences of `name: "` after its
	// opening.
	const start = body.indexOf("ALL_TOOL_DESCRIPTIONS");
	if (start < 0) {
		throw new Error(
			"docs-manifest: ALL_TOOL_DESCRIPTIONS not found in server.ts",
		);
	}
	const end = body.indexOf("];", start);
	const block = body.slice(start, end);
	const matches = block.match(/name:\s*"/g) ?? [];
	return matches.length;
}

function listSkills(): string[] {
	const root = join(ROOT, "packages", "skills");
	const out: string[] = [];
	let entries: string[];
	try {
		entries = readdirSync(root);
	} catch {
		return out;
	}
	for (const name of entries) {
		const full = join(root, name);
		try {
			if (!statSync(full).isDirectory()) continue;
		} catch {
			continue;
		}
		const skillPath = join(full, "SKILL.md");
		try {
			if (statSync(skillPath).isFile()) out.push(name);
		} catch {
			// skip
		}
	}
	return out.sort();
}

function listMcpToolNames(): string[] {
	const path = join(ROOT, "packages", "mcp", "src", "server.ts");
	const body = readFileSync(path, "utf-8");
	const start = body.indexOf("ALL_TOOL_DESCRIPTIONS");
	const end = body.indexOf("];", start);
	const block = body.slice(start, end);
	const names: string[] = [];
	const re = /name:\s*"([^"]+)"/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex scan
	while ((m = re.exec(block)) !== null) {
		names.push(m[1] ?? "");
	}
	return names.filter((n) => n.length > 0);
}

function listVisibleCommandNames(): string[] {
	const path = join(ROOT, "packages", "cli", "src", "program.ts");
	const body = readFileSync(path, "utf-8");
	const start = body.indexOf("// ── Workflow");
	const end = body.indexOf("// ── Internals");
	const visible = body.slice(start, end);
	const names: string[] = [];
	const re = /program\.addCommand\((\w+)Command\(/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex scan
	while ((m = re.exec(visible)) !== null) {
		names.push(m[1] ?? "");
	}
	return names.filter((n) => n.length > 0);
}

// ── Manifest build ──────────────────────────────────────────────────────────

export interface DocsManifest {
	generatedAt: string;
	commands: {
		visible: number;
		names: string[];
	};
	mcpTools: {
		total: number;
		names: string[];
	};
	skills: {
		total: number;
		names: string[];
	};
}

export function buildManifest(): DocsManifest {
	const commandNames = listVisibleCommandNames();
	const toolNames = listMcpToolNames();
	const skillNames = listSkills();
	return {
		generatedAt: new Date().toISOString(),
		commands: {
			visible: countVisibleCommands(),
			names: commandNames,
		},
		mcpTools: {
			total: countMcpTools(),
			names: toolNames,
		},
		skills: {
			total: skillNames.length,
			names: skillNames,
		},
	};
}

// ── --check mode ────────────────────────────────────────────────────────────

const CHECK_PATTERN = /\b(\d+)\s+(commands|MCP tools|skills)\b/gi;

/** Files we scan for hand-typed counts. */
function checkTargets(): string[] {
	const targets: string[] = [join(ROOT, "README.md")];
	const docsRoot = join(ROOT, "packages", "docs", "src", "content", "docs");
	try {
		walkMarkdown(docsRoot, targets);
	} catch {
		// docs package optional
	}
	return targets;
}

function walkMarkdown(dir: string, out: string[]): void {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of entries) {
		const full = join(dir, name);
		let stats: ReturnType<typeof statSync>;
		try {
			stats = statSync(full);
		} catch {
			continue;
		}
		if (stats.isDirectory()) {
			walkMarkdown(full, out);
			continue;
		}
		if (!stats.isFile()) continue;
		if (!name.endsWith(".md") && !name.endsWith(".mdx")) continue;
		out.push(full);
	}
}

interface CheckHit {
	file: string;
	line: number;
	text: string;
}

function runCheck(): number {
	const manifest = buildManifest();
	const hits: CheckHit[] = [];
	for (const file of checkTargets()) {
		let body: string;
		try {
			body = readFileSync(file, "utf-8");
		} catch {
			continue;
		}
		const lines = body.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			// Skip ignore-annotated lines (HTML comment for .md, JSX comment for
			// .mdx). The annotation must appear on the line immediately before
			// the hand-typed count OR on the same line.
			const prev = i > 0 ? (lines[i - 1] ?? "") : "";
			const ignoreMarker =
				/<!--\s*docs-manifest:\s*ignore\s*-->|\{\/\*\s*docs-manifest:\s*ignore\s*\*\/\}/i;
			if (ignoreMarker.test(line) || ignoreMarker.test(prev)) continue;
			const matches = line.matchAll(CHECK_PATTERN);
			for (const _m of matches) {
				hits.push({ file, line: i + 1, text: line.trim() });
			}
		}
	}
	if (hits.length === 0) {
		// eslint-disable-next-line no-console
		console.log(
			"docs-manifest --check: OK — no hand-typed counts in docs sources.",
		);
		// eslint-disable-next-line no-console
		console.log(
			`Live counts → commands=${manifest.commands.visible} mcpTools=${manifest.mcpTools.total} skills=${manifest.skills.total}`,
		);
		return 0;
	}
	// eslint-disable-next-line no-console
	console.error(
		`docs-manifest --check: FAIL — ${hits.length} hand-typed count(s) detected.`,
	);
	for (const h of hits) {
		// eslint-disable-next-line no-console
		console.error(`  ${relative(ROOT, h.file)}:${h.line}  ${h.text}`);
	}
	// eslint-disable-next-line no-console
	console.error(
		"\nFix: remove the hand-typed numbers and link readers to `bun run docs:manifest`.",
	);
	// eslint-disable-next-line no-console
	console.error(
		`Live counts → commands=${manifest.commands.visible} mcpTools=${manifest.mcpTools.total} skills=${manifest.skills.total}`,
	);
	return 1;
}

// ── Entrypoint ──────────────────────────────────────────────────────────────

function main(): void {
	const args = process.argv.slice(2);
	if (args.includes("--check")) {
		process.exit(runCheck());
	}
	const manifest = buildManifest();
	// eslint-disable-next-line no-console
	console.log(JSON.stringify(manifest, null, 2));
}

if (import.meta.main) {
	main();
}
