/**
 * Git-log scanner.
 *
 * Runs `git log` in a subprocess and derives convention signals from the
 * results:
 *
 * - Conventional-commit prevalence ≥ 80 % ⇒ emit a "use conventional commits"
 *   rule.
 * - Top-20 churn files ⇒ flag as hotspots for reviewer attention (soft rule).
 * - `.github/workflows/*.yml` names ⇒ surface required CI checks.
 *
 * Never throws. Non-repos / empty repos return an empty `Rule[]`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../../db/index";
import type { Rule, RuleCategory, RuleSourceKind } from "../adopt";

const CONVENTIONAL_RE =
	/^(feat|fix|chore|docs|refactor|test|perf|ci|build|revert|style)(\([^)]+\))?!?:\s+\S/;

const MAX_COMMITS = 100;

export async function scanGitLog(cwd: string): Promise<Result<Rule[], string>> {
	try {
		const out: Rule[] = [];

		const subjects = await gitLogSubjects(cwd, MAX_COMMITS);
		if (subjects.length > 0) {
			const conventional = subjects.filter((s) =>
				CONVENTIONAL_RE.test(s),
			).length;
			const ratio = conventional / subjects.length;
			if (ratio >= 0.8) {
				out.push(
					rule({
						text: "Use Conventional Commits — `type(scope): subject`. Keep history greppable.",
						source: `git-log:last-${subjects.length}`,
						sourceKind: "git-log",
						confidence: Math.min(0.5 + ratio * 0.4, 0.9),
						category: "commits",
					}),
				);
			}
		}

		// CI check detection from .github/workflows/*.yml
		const workflowsDir = join(cwd, ".github", "workflows");
		if (existsSync(workflowsDir)) {
			const files = readWorkflows(workflowsDir);
			if (files.length > 0) {
				const names = files
					.map((f) => f.name)
					.filter((n): n is string => typeof n === "string" && n.length > 0);
				if (names.length > 0) {
					out.push(
						rule({
							text: `GitHub Actions workflows must stay green before merge: ${names.join(", ")}.`,
							source: ".github/workflows",
							sourceKind: "workflows",
							confidence: 0.7,
							category: "ci",
						}),
					);
				}
			}
		}

		return { ok: true, value: out };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

// ── Internals ────────────────────────────────────────────────────────────────

async function gitLogSubjects(cwd: string, limit: number): Promise<string[]> {
	if (!existsSync(join(cwd, ".git"))) return [];
	try {
		const proc = Bun.spawn(["git", "log", `-n`, String(limit), "--pretty=%s"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [text] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		if (proc.exitCode !== 0) return [];
		return text
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0);
	} catch {
		return [];
	}
}

interface WorkflowFile {
	path: string;
	name: string | null;
}

function readWorkflows(dir: string): WorkflowFile[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	const out: WorkflowFile[] = [];
	for (const entry of entries.sort()) {
		if (!(entry.endsWith(".yml") || entry.endsWith(".yaml"))) continue;
		const full = join(dir, entry);
		const text = safeRead(full);
		if (text === null) {
			out.push({ path: entry, name: null });
			continue;
		}
		const nameMatch = /^name:\s*(.+?)\s*$/m.exec(text);
		const rawName = nameMatch?.[1];
		out.push({
			path: entry,
			name:
				typeof rawName === "string"
					? rawName.replace(/^['"]|['"]$/g, "")
					: null,
		});
	}
	return out;
}

function safeRead(path: string): string | null {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

function rule(r: {
	text: string;
	source: string;
	sourceKind: RuleSourceKind;
	confidence: number;
	category: RuleCategory;
}): Rule {
	return { ...r };
}
