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
	/**
	 * When true, pass all labels to `gh issue create` unchanged (the old
	 * abort-on-missing behavior). When false/undefined (default), pre-fetch
	 * the repo's labels and silently drop any that don't exist, returning
	 * them as `skippedLabels` so the caller can warn. See issue #170.
	 */
	strictLabels?: boolean;
	cwd?: string;
	repo?: string; // Cross-repo: "owner/name" for gh --repo flag
}

export interface TicketResult {
	url: string;
	number: number;
	/** Requested labels that don't exist on the repo (skip-and-warn mode). */
	skippedLabels?: string[];
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

		const db = dbResult.value.db;
		try {
			// Get all unique module names from semantic entities
			const rows = db
				.prepare("SELECT DISTINCT file_path FROM semantic_entities")
				.all() as Array<{ file_path: string }>;

			if (rows.length === 0) {
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

			return [...new Set(matched)];
		} finally {
			db.close();
		}
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
 * Fetch the set of label names that exist on the target repo.
 * Returns null if the listing call fails — callers fall back to passing
 * labels through unchanged and letting `gh issue create` surface the error.
 */
async function listAvailableLabels(
	opts: { cwd?: string; repo?: string },
	deps: SpawnDeps,
): Promise<Set<string> | null> {
	try {
		// --limit caps the total fetched (gh auto-paginates underneath at 100/call).
		// 1000 covers the long tail of repos — anything higher is ~pathological.
		const args = ["gh", "label", "list", "--json", "name", "--limit", "1000"];
		if (opts.repo) args.push("--repo", opts.repo);

		const { exitCode, stdout } = await deps.spawn(args, { cwd: opts.cwd });
		if (exitCode !== 0) return null;

		const parsed = JSON.parse(stdout) as Array<{ name: string }>;
		return new Set(parsed.map((l) => l.name));
	} catch {
		return null;
	}
}

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
		let effectiveLabels = options.labels ?? [];
		const skippedLabels: string[] = [];

		if (effectiveLabels.length > 0 && !options.strictLabels) {
			const available = await listAvailableLabels(
				{ cwd: options.cwd, repo: options.repo },
				deps,
			);
			if (available) {
				const known: string[] = [];
				for (const label of effectiveLabels) {
					if (available.has(label)) known.push(label);
					else skippedLabels.push(label);
				}
				effectiveLabels = known;
			}
		}

		const args = [
			"gh",
			"issue",
			"create",
			"--title",
			options.title,
			"--body",
			options.body,
		];

		if (effectiveLabels.length > 0) {
			args.push("--label", effectiveLabels.join(","));
		}

		if (options.repo) {
			args.push("--repo", options.repo);
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
			value: {
				url,
				number: issueNumber,
				...(skippedLabels.length > 0 ? { skippedLabels } : {}),
			},
		};
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
