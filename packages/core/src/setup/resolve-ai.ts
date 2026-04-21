/**
 * Setup — AI Resolution Chain
 *
 * Single entry point for the `maina setup` wizard's AI call. Tries tiers in
 * order — host → cloud → byok → degraded — and always returns a usable
 * result. Degraded mode produces a generic-but-tailored starter constitution
 * so the wizard can finish offline.
 *
 * Tier rationale:
 * - **host**: zero cost, zero network, host already authenticated (Claude
 *   Code, Cursor). Preferred even when a BYO key is present.
 * - **cloud**: anonymous proxy at `/v1/setup`. Lets first-time users get
 *   real AI without configuring a key. Hard 2s timeout so an outage never
 *   blocks the wizard.
 * - **byok**: user-supplied OpenRouter / Anthropic key.
 * - **degraded**: deterministic fallback. Never errors.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	type DelegationPrompt,
	type TryAIResult,
	tryAIGenerate,
} from "../ai/try-generate";
import { getApiKey, isHostMode } from "../config/index";
import type { Rule } from "./adopt";
import { formatProvenanceComment } from "./adopt";
import type { StackContext } from "./context";
import { loadUniversalPrompt } from "./prompts";
import type { SetupDegradedReason } from "./recovery";
import { renderFileLayoutSection, renderWorkflowSection } from "./tailor";

// ── Types ────────────────────────────────────────────────────────────────────

export type SetupAISource = "host" | "cloud" | "byok" | "degraded";

export interface SetupAIMetadata {
	source: SetupAISource;
	/** Tiers attempted (in order) before — and including — the one that won. */
	attemptedSources: SetupAISource[];
	promptHash?: string;
	/** Cloud-supplied retry-at when degraded after a 429. */
	retryAt?: string;
	/** Normalised reason the degraded tier kicked in. Absent when source !== "degraded". */
	reason?: SetupDegradedReason;
	/** Raw sub-reason (e.g. "timeout", "http_500", "empty_response") for the setup log. */
	reasonDetail?: string;
	durationMs: number;
	usage?: { promptTokens?: number; completionTokens?: number };
}

export type SetupAIResult =
	| {
			source: "host";
			delegation: DelegationPrompt;
			text: null;
			metadata: SetupAIMetadata;
	  }
	| { source: "cloud"; text: string; metadata: SetupAIMetadata }
	| { source: "byok"; text: string; metadata: SetupAIMetadata }
	| { source: "degraded"; text: string; metadata: SetupAIMetadata };

export interface ResolveAIOptions {
	cwd: string;
	stack: StackContext;
	repoSummary: string;
	/** Pre-computed device fingerprint for the cloud rate-limit header. */
	fingerprint: string;
	/** Defaults to `maina/<core-pkg-version>`. */
	userAgent?: string;
	/** Cloud request abort threshold; defaults to 2000 ms. */
	cloudTimeoutMs?: number;
	/** Force a particular tier (e.g. `--force=degraded` for tests/CI). */
	forceSource?: SetupAISource;
	/** `fetch` override for tests. */
	fetchImpl?: typeof fetch;
	/** Host-mode generate override for tests. */
	hostGenerate?: (prompt: string, mainaDir: string) => Promise<TryAIResult>;
	/** BYOK generate override for tests. Returns the model output text. */
	byokGenerate?: (prompt: string) => Promise<string>;
	/**
	 * Rules adopted from existing agent-instruction files. When present,
	 * the universal prompt is augmented with an "Accepted rules" block so
	 * the LLM merges rather than reinvents.
	 */
	adoptedRules?: Rule[];
	/** Rules surfaced by the deterministic scanners (lint-config, git-log, ...). */
	scannedRules?: Rule[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CLOUD_TIMEOUT_MS = 2000;
const DEFAULT_USER_AGENT = "maina/setup";
const CLOUD_URL = process.env.MAINA_CLOUD_URL ?? "https://api.mainahq.com";
const CLOUD_PATH = "/v1/setup";

// ── Public Entry Point ───────────────────────────────────────────────────────

/**
 * Resolve the setup AI call across all tiers. Always succeeds.
 */
export async function resolveSetupAI(
	opts: ResolveAIOptions,
): Promise<SetupAIResult> {
	const start = Date.now();
	const stackString = stackToString(opts.stack);
	const basePrompt = loadUniversalPrompt({
		stack: stackString,
		repoSummary: opts.repoSummary,
	});
	const prompt = augmentPromptWithRules(basePrompt, {
		adopted: opts.adoptedRules ?? [],
		scanned: opts.scannedRules ?? [],
		languages: opts.stack.languages,
		toplevelDirs: listToplevelDirs(opts.cwd),
	});

	const attempted: SetupAISource[] = [];
	let degradedHint: {
		reason?: SetupDegradedReason;
		reasonDetail?: string;
		retryAt?: string;
	} = {};

	const wantTier = (tier: SetupAISource): boolean => {
		if (opts.forceSource === undefined) return true;
		return opts.forceSource === tier;
	};

	// ── 1. Host ────────────────────────────────────────────────────────────────
	let hostFailed = false;
	if (wantTier("host") && isHostMode()) {
		attempted.push("host");
		const hostResult = await runHostTier(opts, prompt);
		if (hostResult !== null) {
			if (hostResult.kind === "delegation") {
				return {
					source: "host",
					delegation: hostResult.delegation,
					text: null,
					metadata: {
						source: "host",
						attemptedSources: [...attempted],
						promptHash: hostResult.promptHash,
						durationMs: Date.now() - start,
					},
				};
			}
			// Host returned actual text (rare — has key inside host)
			return {
				source: "byok",
				text: hostResult.text,
				metadata: {
					source: "byok",
					attemptedSources: [...attempted],
					promptHash: hostResult.promptHash,
					durationMs: Date.now() - start,
				},
			};
		}
		// Host was the preferred tier and returned null — record so we can
		// surface `host_unavailable` instead of a downstream reason if nothing
		// else succeeds. Per spec: a user inside Claude Code should see that
		// host specifically failed, not a generic "ai_unavailable".
		hostFailed = true;
		degradedHint = {
			reason: "host_unavailable",
			reasonDetail: "host_returned_null",
		};
	}

	// ── 2. Cloud (anonymous proxy) ─────────────────────────────────────────────
	if (wantTier("cloud")) {
		attempted.push("cloud");
		const cloudResult = await runCloudTier(opts, prompt, stackString);
		if (cloudResult.kind === "ok") {
			return {
				source: "cloud",
				text: cloudResult.text,
				metadata: {
					source: "cloud",
					attemptedSources: [...attempted],
					durationMs: Date.now() - start,
					usage: cloudResult.usage,
				},
			};
		}
		// Capture cloud-side hints. Rate-limit always wins (it has retry info).
		// Generic cloud errors do not overwrite an earlier `host_unavailable`
		// hint because host was the preferred tier — telling the user "cloud
		// returned 500" when they are inside Claude Code hides the real story.
		if (cloudResult.kind === "rate_limited") {
			degradedHint = {
				reason: "rate_limited",
				reasonDetail: "http_429",
				retryAt: cloudResult.retryAt,
			};
		} else if (!hostFailed) {
			degradedHint = {
				reason: "ai_unavailable",
				reasonDetail: cloudResult.reason,
			};
		} else {
			// Preserve host_unavailable reason, but append cloud error to detail
			degradedHint = {
				reason: "host_unavailable",
				reasonDetail: `host_returned_null; cloud=${cloudResult.reason}`,
			};
		}
	}

	// ── 3. BYOK ───────────────────────────────────────────────────────────────
	let byokAttempted = false;
	if (wantTier("byok")) {
		attempted.push("byok");
		const apiKey = getApiKey();
		if (apiKey !== null || opts.byokGenerate !== undefined) {
			byokAttempted = true;
			const text = await runByokTier(opts, prompt);
			if (text !== null) {
				return {
					source: "byok",
					text,
					metadata: {
						source: "byok",
						attemptedSources: [...attempted],
						durationMs: Date.now() - start,
					},
				};
			}
			// byok was attempted but failed — overrides earlier hints
			degradedHint = {
				reason: "byok_failed",
				reasonDetail: "byok_empty_or_error",
			};
		}
	}

	// ── 4. Degraded (always succeeds) ─────────────────────────────────────────
	attempted.push("degraded");
	let reason: SetupDegradedReason;
	if (opts.forceSource === "degraded") {
		reason = "forced";
	} else if (degradedHint.reason !== undefined) {
		reason = degradedHint.reason;
	} else if (!byokAttempted && getApiKey() === null) {
		reason = "no_key";
	} else {
		reason = "ai_unavailable";
	}
	return {
		source: "degraded",
		text: buildGenericConstitution(opts.stack, {
			toplevelDirs: listToplevelDirs(opts.cwd),
			adoptedRules: opts.adoptedRules ?? [],
			scannedRules: opts.scannedRules ?? [],
		}),
		metadata: {
			source: "degraded",
			attemptedSources: [...attempted],
			reason,
			reasonDetail: degradedHint.reasonDetail,
			retryAt: degradedHint.retryAt,
			durationMs: Date.now() - start,
		},
	};
}

// ── Tier: Host ───────────────────────────────────────────────────────────────

type HostOutcome =
	| { kind: "delegation"; delegation: DelegationPrompt; promptHash?: string }
	| { kind: "text"; text: string; promptHash?: string };

async function runHostTier(
	opts: ResolveAIOptions,
	prompt: string,
): Promise<HostOutcome | null> {
	const mainaDir = join(opts.cwd, ".maina");
	const variables = {
		stack: stackToString(opts.stack),
		repoSummary: opts.repoSummary,
	};
	let result: TryAIResult;
	try {
		const fn =
			opts.hostGenerate ??
			((p: string, d: string) => tryAIGenerate("setup", d, variables, p));
		result = await fn(prompt, mainaDir);
	} catch {
		return null;
	}
	if (result.hostDelegation && result.delegation) {
		return {
			kind: "delegation",
			delegation: result.delegation,
			promptHash: result.promptHash,
		};
	}
	if (typeof result.text === "string" && result.text.trim().length > 0) {
		return { kind: "text", text: result.text, promptHash: result.promptHash };
	}
	// Empty / null — fall through
	return null;
}

// ── Tier: Cloud ──────────────────────────────────────────────────────────────

type CloudOutcome =
	| {
			kind: "ok";
			text: string;
			usage?: { promptTokens?: number; completionTokens?: number };
	  }
	| { kind: "rate_limited"; retryAt?: string }
	| { kind: "error"; reason: string };

async function runCloudTier(
	opts: ResolveAIOptions,
	prompt: string,
	stackString: string,
): Promise<CloudOutcome> {
	const fetcher = opts.fetchImpl ?? fetch;
	const timeoutMs = opts.cloudTimeoutMs ?? DEFAULT_CLOUD_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const body = JSON.stringify({
			stack: stackString,
			prompt: truncate(prompt, 8_000),
			context: truncate(opts.repoSummary, 40_000),
		});
		const response = await fetcher(`${CLOUD_URL}${CLOUD_PATH}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				"X-Maina-Fingerprint": opts.fingerprint,
				"User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT,
			},
			body,
			signal: controller.signal,
		});

		// 429 — capture retryAt and fall through
		if (response.status === 429) {
			const parsed = await safeJson(response);
			const meta = (parsed?.meta as Record<string, unknown> | undefined) ?? {};
			return {
				kind: "rate_limited",
				retryAt:
					typeof meta.retryAt === "string"
						? meta.retryAt
						: typeof meta.retry_at === "string"
							? (meta.retry_at as string)
							: undefined,
			};
		}

		// Any other non-2xx → fall through
		if (!response.ok) {
			return { kind: "error", reason: `http_${response.status}` };
		}

		const parsed = await safeJson(response);
		if (parsed === null) {
			// Malformed JSON — treat as 5xx
			return { kind: "error", reason: "malformed_json" };
		}
		const data = parsed.data as
			| {
					text?: string;
					usage?: { promptTokens?: number; completionTokens?: number };
			  }
			| null
			| undefined;
		if (!data || typeof data.text !== "string" || data.text.length === 0) {
			return { kind: "error", reason: "empty_response" };
		}
		return { kind: "ok", text: data.text, usage: data.usage };
	} catch (e) {
		if (e instanceof DOMException && e.name === "AbortError") {
			return { kind: "error", reason: "timeout" };
		}
		return {
			kind: "error",
			reason: e instanceof Error ? e.message : "network_error",
		};
	} finally {
		clearTimeout(timer);
	}
}

// ── Tier: BYOK ───────────────────────────────────────────────────────────────

async function runByokTier(
	opts: ResolveAIOptions,
	prompt: string,
): Promise<string | null> {
	try {
		if (opts.byokGenerate !== undefined) {
			const text = await opts.byokGenerate(prompt);
			if (typeof text === "string" && text.trim().length > 0) return text;
			return null;
		}
		// Real path: use the existing AI pipeline.
		const { generate } = await import("../ai/index");
		const result = await generate({
			task: "setup",
			systemPrompt:
				"You are the maina setup assistant. Produce a project constitution as concise markdown.",
			userPrompt: prompt,
			mainaDir: join(opts.cwd, ".maina"),
		});
		const text = result.text ?? "";
		// `generate()` returns explanatory strings on failure — filter those out
		if (
			text.length === 0 ||
			text.startsWith("[HOST_DELEGATION]") ||
			text.startsWith("No API key") ||
			text.startsWith("AI call failed")
		) {
			return null;
		}
		return text;
	} catch {
		return null;
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stackToString(stack: StackContext): string {
	const langs = stack.languages.join("+") || "unknown";
	const pm = stack.packageManager;
	const linters = stack.linters.join("+") || "no-linter";
	return `${langs}+${pm}+${linters}`;
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 32)}\n\n[...truncated]`;
}

async function safeJson(
	response: Response,
): Promise<Record<string, unknown> | null> {
	try {
		return (await response.json()) as Record<string, unknown>;
	} catch {
		return null;
	}
}

// ── Generic Constitution (degraded) ──────────────────────────────────────────

/**
 * Build a generic-but-stack-tailored starter constitution. Used when every
 * AI tier fails — but ALWAYS includes the `## Maina Workflow` and `## File
 * Layout` sections verbatim, so downstream maina commands have something to
 * anchor to regardless of which tier produced the file.
 *
 * The `extras` argument is optional so callers that only have a
 * `StackContext` (legacy tests) continue to work; in that case we emit a
 * minimal layout section with no toplevel-dir hints.
 */
export function buildGenericConstitution(
	stack: StackContext,
	extras?: {
		toplevelDirs?: string[];
		adoptedRules?: Rule[];
		scannedRules?: Rule[];
	},
): string {
	const langs =
		stack.languages.length > 0 ? stack.languages.join(", ") : "your stack";
	const linters =
		stack.linters.length > 0 ? stack.linters.join(", ") : "your linter";
	const tests =
		stack.testRunners.length > 0
			? stack.testRunners.join(", ")
			: "your test runner";
	const pm = stack.packageManager;

	const sections: string[] = [];
	sections.push("# Project Constitution", "");
	sections.push(
		"> Generated offline by `maina setup` — refine this after the wizard finishes.",
		"",
	);
	sections.push("## Stack", "");
	sections.push(`- Languages: ${langs}`);
	sections.push(`- Package manager: ${pm}`);
	sections.push(`- Linters: ${linters}`);
	sections.push(`- Test runners: ${tests}`);
	sections.push("");

	const ruleLines: string[] = [];
	for (const rule of extras?.adoptedRules ?? []) {
		ruleLines.push(`- ${rule.text} ${formatProvenanceComment(rule)}`);
	}
	for (const rule of extras?.scannedRules ?? []) {
		ruleLines.push(`- ${rule.text} ${formatProvenanceComment(rule)}`);
	}
	if (ruleLines.length > 0) {
		sections.push("## Rules", "");
		sections.push(...ruleLines);
		sections.push("");
	}

	sections.push(
		"## Principles",
		"",
		"1. **Tests first.** Write a failing test, then make it pass.",
		"2. **Small, reviewable diffs.** Prefer many small PRs over one large PR.",
		"3. **Conventional commits.** `type(scope): subject` — keep history greppable.",
		"4. **No silent failures.** Use `Result<T, E>` or explicit error returns; never swallow exceptions.",
		"5. **Lint and type-check before push.** Block on errors locally so CI stays green.",
		"",
		"## Definition of Done",
		"",
		`- All tests pass (\`${tests}\`).`,
		`- Linter is clean (\`${linters}\`).`,
		"- Type checks pass.",
		"- Code review approved by one other engineer.",
		"",
		"## What Not To Do",
		"",
		"- Do not commit secrets or generated artefacts.",
		"- Do not bypass linters with blanket `disable` directives.",
		"- Do not commit `console.log` / `print` debugging statements.",
		"- Do not skip tests with `.skip` / `.only` outside short-lived debugging.",
		"",
	);

	sections.push(renderWorkflowSection(), "");
	sections.push(
		renderFileLayoutSection({
			languages: stack.languages,
			toplevelDirs: extras?.toplevelDirs ?? [],
		}),
	);

	return `${sections.join("\n")}\n`;
}

// ── Rule-aware prompt augmentation ───────────────────────────────────────────

function augmentPromptWithRules(
	base: string,
	opts: {
		adopted: Rule[];
		scanned: Rule[];
		languages: string[];
		toplevelDirs: string[];
	},
): string {
	if (opts.adopted.length === 0 && opts.scanned.length === 0) {
		return base;
	}
	const lines: string[] = [base, ""];
	lines.push("### Accepted rules (merge; do NOT invent new ones)");
	lines.push("");
	for (const rule of opts.adopted) {
		lines.push(`- ${rule.text} ${formatProvenanceComment(rule)}`);
	}
	for (const rule of opts.scanned) {
		lines.push(`- ${rule.text} ${formatProvenanceComment(rule)}`);
	}
	lines.push("");
	lines.push("### Workflow section — include verbatim in your output");
	lines.push("");
	lines.push(renderWorkflowSection());
	lines.push("");
	lines.push("### File-layout section — include verbatim in your output");
	lines.push("");
	lines.push(
		renderFileLayoutSection({
			languages: opts.languages,
			toplevelDirs: opts.toplevelDirs,
		}),
	);
	return lines.join("\n");
}

function listToplevelDirs(cwd: string): string[] {
	if (!existsSync(cwd)) return [];
	try {
		return readdirSync(cwd)
			.filter((entry) => {
				if (entry.startsWith(".")) return false;
				if (
					entry === "node_modules" ||
					entry === "dist" ||
					entry === "build" ||
					entry === "out" ||
					entry === "target" ||
					entry === "coverage"
				) {
					return false;
				}
				try {
					return statSync(join(cwd, entry)).isDirectory();
				} catch {
					return false;
				}
			})
			.sort()
			.slice(0, 12);
	} catch {
		return [];
	}
}
