/**
 * `seedWiki` — sub-task 6 of `maina setup`.
 *
 * Coordinates the first wiki compile during setup with three constraints:
 *   1. **Empty repo:** skip silently, do not fabricate a success message.
 *   2. **Already present:** prompt to rebuild (interactive) or default to keep
 *      (non-interactive). We do not blow away an existing wiki without consent.
 *   3. **Time budget:** 10s in the foreground. If compile takes longer, the
 *      promise keeps running in the background and we return immediately so the
 *      wizard can finish. Background failures are logged to
 *      `.maina/logs/setup.log` (append-only) — they do not fail setup.
 *
 * The actual compile work is delegated to `wikiCompileAction({ sample: true })`
 * (see `commands/wiki/compile.ts`), which in sample mode caps the source-file
 * set so the foreground budget is realistic for moderately sized repos.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { wikiCompileAction } from "./wiki/compile";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SeedWikiOptions {
	cwd: string;
	/** From `StackContext.isEmpty` — repo has no detectable source files. */
	stackIsEmpty: boolean;
	/** True when `.maina/wiki/` already exists on disk. */
	wikiAlreadyPresent: boolean;
	/** True when neither `--ci` nor `--yes` was passed. */
	interactive: boolean;
	/** True when `--yes` was passed (assume defaults). */
	yes: boolean;
	/** Foreground time budget. Defaults to 10s. */
	timeoutMs?: number;
	// ── DI for testing ──────────────────────────────────────────────────────
	compile?: (opts: {
		cwd: string;
		sample: boolean;
	}) => Promise<{ pages: number }>;
	prompt?: (msg: string) => Promise<boolean>;
	logger?: {
		info: (m: string) => void;
		warning: (m: string) => void;
		success: (m: string) => void;
	};
}

export interface SeedWikiResult {
	/** Did we actually invoke the compiler. */
	ran: boolean;
	/** Why we did not run, if applicable. */
	skipped: "empty-repo" | "user-kept" | null;
	/** Page count when known; `null` when backgrounded or errored. */
	pages: number | null;
	/** True when the compile timed out and continues in background. */
	backgrounded: boolean;
	/** Foreground error message, if compile rejected before timeout. */
	error: string | null;
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10_000;

const NOOP_LOGGER = {
	info: () => {},
	warning: () => {},
	success: () => {},
};

async function defaultCompile(opts: {
	cwd: string;
	sample: boolean;
}): Promise<{ pages: number }> {
	const result = await wikiCompileAction({
		cwd: opts.cwd,
		sample: opts.sample,
		json: true, // keep the wiki command quiet during setup
		full: true, // first-time seed is always a full pass
	});
	return { pages: result.articlesTotal };
}

const TIMEOUT_SENTINEL = Symbol("seedWiki.timeout");

// ── Action ──────────────────────────────────────────────────────────────────

/**
 * Run the first wiki compile. Always resolves; never throws.
 */
export async function seedWiki(opts: SeedWikiOptions): Promise<SeedWikiResult> {
	const logger = opts.logger ?? NOOP_LOGGER;
	const compile = opts.compile ?? defaultCompile;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	// 1. Empty repo → skip with no fake success.
	if (opts.stackIsEmpty) {
		return {
			ran: false,
			skipped: "empty-repo",
			pages: null,
			backgrounded: false,
			error: null,
		};
	}

	// 2. Wiki already present → prompt or default-keep.
	if (opts.wikiAlreadyPresent) {
		let rebuild = false;
		if (opts.interactive && opts.prompt) {
			rebuild = await opts.prompt("Wiki already exists. Rebuild?");
		} else {
			// --yes / --ci: do not destroy existing work
			rebuild = false;
		}
		if (!rebuild) {
			return {
				ran: false,
				skipped: "user-kept",
				pages: null,
				backgrounded: false,
				error: null,
			};
		}
	}

	// 3. Race the compile against the foreground budget.
	const compilePromise = compile({ cwd: opts.cwd, sample: true });

	// Keep a reference so we can attach a `.catch` for background continuation.
	// We swallow the rejection here for the race itself; the foreground arm
	// re-throws via the wrapper below to let the catch decide.
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
		timeoutHandle = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
	});

	let raceWinner:
		| { kind: "compile"; value: { pages: number } }
		| { kind: "compile-error"; error: unknown }
		| { kind: "timeout" };

	try {
		const winner = await Promise.race([
			compilePromise.then(
				(value) => ({ kind: "compile" as const, value }),
				(error) => ({ kind: "compile-error" as const, error }),
			),
			timeoutPromise.then(() => ({ kind: "timeout" as const })),
		]);
		raceWinner = winner;
	} finally {
		if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
	}

	if (raceWinner.kind === "compile") {
		logger.success(`Wiki seeded (${raceWinner.value.pages} pages).`);
		return {
			ran: true,
			skipped: null,
			pages: raceWinner.value.pages,
			backgrounded: false,
			error: null,
		};
	}

	if (raceWinner.kind === "compile-error") {
		const msg =
			raceWinner.error instanceof Error
				? raceWinner.error.message
				: String(raceWinner.error);
		logger.warning(`Wiki seed failed: ${msg}`);
		return {
			ran: true,
			skipped: null,
			pages: null,
			backgrounded: false,
			error: msg,
		};
	}

	// Timeout: keep the compile running in the background, hook a logger
	// onto its eventual settlement, and return immediately.
	logger.info(
		"Wiki compile is taking longer than expected — continuing in background.",
	);
	compilePromise.catch((err: unknown) => {
		writeBackgroundLog(opts.cwd, err);
	});
	return {
		ran: true,
		skipped: null,
		pages: null,
		backgrounded: true,
		error: null,
	};
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function writeBackgroundLog(cwd: string, err: unknown): void {
	try {
		const dir = join(cwd, ".maina", "logs");
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "setup.log");
		const ts = new Date().toISOString();
		const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
		appendFileSync(file, `[${ts}] wiki background compile failed: ${msg}\n`);
	} catch {
		// last-resort: swallow — we cannot fail setup from a background hook.
	}
}
