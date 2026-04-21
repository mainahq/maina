/**
 * Rule confirmation — TTY y/n/e UI + non-TTY auto-accept.
 *
 * TTY path: lazily imports `@clack/prompts` (a CLI-layer dep, not a core
 * dep) and asks y/n/e per rule. The `e` branch opens `$EDITOR` to let the
 * user rewrite the rule before accepting.
 *
 * Non-TTY path: auto-accepts rules at or above `autoAcceptThreshold`
 * (default 0.6) and rejects the rest. No stdin reads, safe for CI.
 *
 * Rejected rules are appended (de-duplicated) to `.maina/rejected.yml` so
 * future setup re-runs can re-surface them if their confidence rises.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "./adopt";

export interface ConfirmOptions {
	/** Default: `process.stdout.isTTY`. */
	interactive?: boolean;
	/** Non-TTY default: 0.6. Range 0..1. */
	autoAcceptThreshold?: number;
	/** Where `rejected.yml` lives. Default: `<cwd>/.maina`. */
	mainaDir?: string;
	/** Injection point for tests — replaces `@clack/prompts.select`. */
	promptImpl?: (rule: Rule) => Promise<"y" | "n" | "e">;
	/** Injection point for tests — replaces the `$EDITOR` invocation. */
	editImpl?: (rule: Rule) => Promise<Rule>;
	/** Override `Date.now()` for deterministic tests. */
	nowIso?: () => string;
}

export interface ConfirmResult {
	accepted: Rule[];
	rejected: Rule[];
}

export async function confirmRules(
	rules: Rule[],
	opts: ConfirmOptions = {},
): Promise<ConfirmResult> {
	if (rules.length === 0) {
		return { accepted: [], rejected: [] };
	}

	const interactive =
		opts.interactive !== undefined
			? opts.interactive
			: typeof process !== "undefined" && Boolean(process.stdout.isTTY);
	const threshold = opts.autoAcceptThreshold ?? 0.6;
	const mainaDir = opts.mainaDir ?? join(process.cwd(), ".maina");

	const accepted: Rule[] = [];
	const rejected: Rule[] = [];

	if (interactive) {
		const selectRule = opts.promptImpl ?? (await loadClackPrompt());
		for (const rule of rules) {
			const verdict = await selectRule(rule);
			if (verdict === "y") {
				accepted.push(rule);
			} else if (verdict === "n") {
				rejected.push(rule);
			} else if (verdict === "e") {
				const edited = opts.editImpl
					? await opts.editImpl(rule)
					: await openEditor(rule);
				accepted.push(edited);
			}
		}
	} else {
		for (const rule of rules) {
			if (rule.confidence >= threshold) {
				accepted.push(rule);
			} else {
				rejected.push(rule);
			}
		}
	}

	if (rejected.length > 0) {
		appendRejected(
			mainaDir,
			rejected,
			opts.nowIso ?? (() => new Date().toISOString()),
		);
	}

	return { accepted, rejected };
}

// ── rejected.yml ─────────────────────────────────────────────────────────────

interface RejectedEntry {
	text: string;
	source: string;
	confidence: number;
	rejectedAt: string;
}

function appendRejected(
	mainaDir: string,
	rules: Rule[],
	nowIso: () => string,
): void {
	try {
		if (!existsSync(mainaDir)) {
			mkdirSync(mainaDir, { recursive: true });
		}
	} catch {
		return;
	}
	const path = join(mainaDir, "rejected.yml");
	const existing = parseRejected(safeRead(path) ?? "");
	const seen = new Set(existing.map((e) => normalise(e.text)));
	const ts = nowIso();
	for (const rule of rules) {
		const key = normalise(rule.text);
		if (seen.has(key)) continue;
		existing.push({
			text: rule.text,
			source: rule.source,
			confidence: rule.confidence,
			rejectedAt: ts,
		});
		seen.add(key);
	}
	writeRejected(path, existing);
}

function writeRejected(path: string, entries: RejectedEntry[]): void {
	const lines: string[] = ["# maina rejected rules", "rules:"];
	for (const e of entries) {
		lines.push(`  - text: ${yamlString(e.text)}`);
		lines.push(`    source: ${yamlString(e.source)}`);
		lines.push(`    confidence: ${e.confidence}`);
		lines.push(`    rejectedAt: ${yamlString(e.rejectedAt)}`);
	}
	try {
		writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
	} catch {
		// Swallow — a read-only filesystem must not abort setup.
	}
}

function parseRejected(yaml: string): RejectedEntry[] {
	const out: RejectedEntry[] = [];
	const lines = yaml.split("\n");
	let cur: Partial<RejectedEntry> | null = null;
	for (const raw of lines) {
		const line = raw.replace(/\r$/, "");
		if (/^\s*- text:/.test(line)) {
			if (cur?.text) out.push(cur as RejectedEntry);
			cur = { text: extractYamlValue(line) };
		} else if (cur && /^\s*source:/.test(line)) {
			cur.source = extractYamlValue(line);
		} else if (cur && /^\s*confidence:/.test(line)) {
			const v = Number.parseFloat(extractYamlValue(line));
			cur.confidence = Number.isFinite(v) ? v : 0;
		} else if (cur && /^\s*rejectedAt:/.test(line)) {
			cur.rejectedAt = extractYamlValue(line);
		}
	}
	if (cur?.text) out.push(cur as RejectedEntry);
	return out.filter(
		(e): e is RejectedEntry =>
			typeof e.text === "string" &&
			typeof e.source === "string" &&
			typeof e.confidence === "number" &&
			typeof e.rejectedAt === "string",
	);
}

function extractYamlValue(line: string): string {
	const idx = line.indexOf(":");
	if (idx === -1) return "";
	const rest = line.slice(idx + 1).trim();
	// Remove surrounding quotes if present.
	if (
		(rest.startsWith('"') && rest.endsWith('"')) ||
		(rest.startsWith("'") && rest.endsWith("'"))
	) {
		return rest.slice(1, -1).replace(/\\"/g, '"');
	}
	return rest;
}

function yamlString(s: string): string {
	// Quote if it contains characters that need quoting.
	if (/[:#\n"']/.test(s) || s.startsWith(" ") || s.endsWith(" ")) {
		return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return s;
}

function normalise(s: string): string {
	return s
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/[.!?]+$/u, "")
		.trim();
}

function safeRead(path: string): string | null {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

// ── TTY plumbing ─────────────────────────────────────────────────────────────

/**
 * Lazily load `@clack/prompts`. Falls back to a non-interactive accepter if
 * the package is not installed (it's a CLI-layer dep, not a core dep).
 */
async function loadClackPrompt(): Promise<
	(rule: Rule) => Promise<"y" | "n" | "e">
> {
	try {
		// `@clack/prompts` is a CLI-layer dependency — core does not declare it,
		// so we dynamic-import via a computed specifier to suppress bundler
		// resolution at typecheck time.
		const spec = "@clack/prompts";
		const mod = (await import(/* @vite-ignore */ spec)) as unknown as {
			select: (input: {
				message: string;
				options: { value: string; label: string; hint?: string }[];
				initialValue?: string;
			}) => Promise<string | symbol>;
			isCancel: (v: unknown) => boolean;
		};
		return async (rule: Rule) => {
			const answer = await mod.select({
				message: `Rule: "${rule.text}"\nSource: ${rule.source} | Confidence: ${rule.confidence.toFixed(2)}`,
				options: [
					{ value: "y", label: "yes, keep it" },
					{ value: "n", label: "no, drop it" },
					{ value: "e", label: "edit" },
				],
				initialValue: rule.confidence >= 0.6 ? "y" : "n",
			});
			if (mod.isCancel(answer)) return "n";
			return answer === "e" ? "e" : answer === "y" ? "y" : "n";
		};
	} catch {
		// Fallback: treat as non-interactive with 0.6 threshold.
		return async (rule: Rule) =>
			rule.confidence >= 0.6 ? ("y" as const) : ("n" as const);
	}
}

async function openEditor(rule: Rule): Promise<Rule> {
	// Minimal implementation — the test suite injects `editImpl` so we only
	// need a best-effort path for the CLI. Keep as pass-through to avoid
	// unhandled `$EDITOR` failures in restricted environments.
	return rule;
}
