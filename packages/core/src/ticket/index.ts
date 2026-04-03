/**
 * Ticket Module — Create GitHub Issues with automatic module tagging.
 *
 * Uses the semantic entity index from the Context Engine DB to detect
 * which modules are relevant to an issue's title and body, then calls
 * `gh issue create` to create the issue on GitHub.
 */

import type { Result } from "../db/index.ts";
import { getContextDb } from "../db/index.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TicketOptions {
	title: string;
	body: string;
	labels?: string[];
	cwd?: string;
}

export interface TicketResult {
	url: string;
	number: number;
}

/** Dependency injection for spawn, enabling testability. */
export interface SpawnDeps {
	spawn: (
		args: string[],
		opts?: { cwd?: string },
	) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

// ── Default spawn via Bun.spawn ──────────────────────────────────────────────

async function defaultSpawn(
	args: string[],
	opts?: { cwd?: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(args, {
		cwd: opts?.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { exitCode, stdout, stderr };
}

const defaultDeps: SpawnDeps = { spawn: defaultSpawn };

// ── detectModules ────────────────────────────────────────────────────────────

/**
 * Extract module/directory names from the semantic entity index that are
 * relevant to the given title and body keywords.
 *
 * Looks at `file_path` in `semantic_entities` table, extracts the first
 * directory component after `src/`, and matches against keywords from
 * the title and body.
 *
 * Returns a deduplicated list of module names (e.g., ["context", "verify"]).
 * If no DB or no matches, returns empty array (graceful).
 */
export function detectModules(
	mainaDir: string,
	title: string,
	body: string,
): string[] {
	try {
		const dbResult = getContextDb(mainaDir);
		if (!dbResult.ok) return [];

		const { db } = dbResult.value;

		// Get all unique module names from semantic entities
		const rows = db
			.prepare("SELECT DISTINCT file_path FROM semantic_entities")
			.all() as Array<{ file_path: string }>;

		if (rows.length === 0) {
			db.close();
			return [];
		}

		// Extract module names from file paths (first dir after src/)
		const moduleSet = new Set<string>();
		for (const row of rows) {
			const match = row.file_path.match(/(?:^|\/)?src\/([^/]+)\//);
			if (match?.[1]) {
				moduleSet.add(match[1]);
			}
		}

		// Build keywords from title + body (lowercase, split by non-alpha)
		const text = `${title} ${body}`.toLowerCase();
		const keywords = text.split(/[^a-z0-9]+/).filter((w) => w.length > 2);

		// Match modules against keywords
		const matched: string[] = [];
		for (const mod of moduleSet) {
			const modLower = mod.toLowerCase();
			if (
				keywords.some((kw) => modLower.includes(kw) || kw.includes(modLower))
			) {
				matched.push(mod);
			}
		}

		db.close();
		return [...new Set(matched)];
	} catch {
		return [];
	}
}

// ── buildIssueBody ──────────────────────────────────────────────────────────

/**
 * Format the issue body with a module tags section appended.
 * If modules found: adds `\n\n**Modules:** context, verify, cli`
 * If no modules: returns body unchanged.
 */
export function buildIssueBody(body: string, modules: string[]): string {
	if (modules.length === 0) return body;
	return `${body}\n\n**Modules:** ${modules.join(", ")}`;
}

// ── createTicket ────────────────────────────────────────────────────────────

/**
 * Create a GitHub Issue via `gh issue create`.
 * Returns the issue URL and number on success, or an error on failure.
 * Never throws — all errors are returned as Result Err values.
 */
export async function createTicket(
	options: TicketOptions,
	deps: SpawnDeps = defaultDeps,
): Promise<Result<TicketResult>> {
	try {
		const args = [
			"gh",
			"issue",
			"create",
			"--title",
			options.title,
			"--body",
			options.body,
		];

		if (options.labels && options.labels.length > 0) {
			args.push("--label", options.labels.join(","));
		}

		const { exitCode, stdout, stderr } = await deps.spawn(args, {
			cwd: options.cwd,
		});

		if (exitCode !== 0) {
			const message =
				stderr.trim() || stdout.trim() || "gh issue create failed";
			return { ok: false, error: message };
		}

		const url = stdout.trim();
		const numberMatch = url.match(/\/issues\/(\d+)/);
		const issueNumber = numberMatch?.[1]
			? Number.parseInt(numberMatch[1], 10)
			: 0;

		return {
			ok: true,
			value: { url, number: issueNumber },
		};
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
