/**
 * Receipt builder — turns a pipeline result into a v1 receipt object.
 *
 * Pure function. No I/O beyond agent detection + repo slug lookup.
 * Canonicalizes + hashes the resulting receipt per adr/0030.
 */

import { getRepoSlug } from "../git/index";
import type { Finding as PipelineFinding } from "../verify/diff-filter";
import type { PipelineResult } from "../verify/pipeline";
import { detectAgent } from "./agent-id";
import type {
	Check,
	CheckStatus,
	CheckTool,
	Receipt,
	Finding as ReceiptFinding,
} from "./types";
import { computeHash } from "./verify";

/**
 * Map internal pipeline tool names to the v1 CheckTool enum.
 *
 * Tools with `null` are not part of the v1 wire format and get dropped from
 * the receipt. A future ADR will widen the enum for v2 to include typecheck,
 * consistency, and wiki-lint — for now they're internal signals only.
 */
const TOOL_MAPPING: Record<string, CheckTool | null> = {
	slop: "slop",
	"doc-claims": "doc-claims",
	semgrep: "semgrep",
	trivy: "trivy",
	secretlint: "secretlint",
	sonarqube: "sonar",
	stryker: "stryker",
	"diff-cover": "diff-cover",
	builtin: "biome",
	"ai-review": "review-quality",
	typecheck: null,
	consistency: null,
	"wiki-lint": null,
};

const CHECK_NAMES: Record<CheckTool, string> = {
	biome: "Biome lint + format",
	semgrep: "Semgrep patterns",
	sonar: "SonarQube static analysis",
	trivy: "Trivy dependency scan",
	secretlint: "Secret scan",
	"diff-cover": "Diff coverage",
	stryker: "Mutation testing",
	slop: "AI slop detector",
	"review-spec": "Spec compliance review",
	"review-quality": "Code quality review",
	tests: "Test run",
	visual: "Visual diff",
	"doc-claims": "Doc claims check",
};

export interface BuildReceiptInput {
	prTitle: string;
	pipeline: PipelineResult;
	modelVersion?: string;
	constitutionHash: string;
	promptsHash: string;
	diff?: { additions: number; deletions: number; files: number };
	retries?: number;
	walkthrough?: string;
	cwd?: string;
}

export type BuildReceiptResult =
	| { ok: true; data: Receipt }
	| { ok: false; code: "canonicalize-failed"; message: string };

const REPO_SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function buildReceipt(
	input: BuildReceiptInput,
): Promise<BuildReceiptResult> {
	const cwd = input.cwd ?? process.cwd();
	const rawSlug = (await getRepoSlug(cwd)) || "";
	const repo = REPO_SLUG_PATTERN.test(rawSlug) ? rawSlug : "unknown/unknown";
	const agent = await detectAgent({ modelVersion: input.modelVersion, cwd });

	const mappedChecks = input.pipeline.tools
		.map((report): Check | null => {
			const tool = TOOL_MAPPING[report.tool];
			if (!tool) return null;
			const findings = report.findings.map(mapFinding);
			const status: CheckStatus = report.skipped
				? "skipped"
				: findings.some((f) => f.severity === "error")
					? "failed"
					: "passed";
			return {
				id: `${tool}-check`,
				name: CHECK_NAMES[tool],
				status,
				tool,
				findings,
			};
		})
		.filter((c): c is Check => c !== null);

	// If the pipeline failed but every dropped tool's failure is invisible (typecheck,
	// consistency, wiki-lint, syntax-guard), surface a synthetic check so the receipt
	// always names *why* it didn't pass.
	const checks = surfaceHiddenFailures(input.pipeline, mappedChecks);

	const retries = input.retries ?? 0;
	const baseStatus = derivePipelineStatus(input.pipeline, checks);
	// Constitution C3 — cap at 3 forces partial regardless of underlying outcome.
	const status = retries >= 3 ? "partial" : baseStatus;

	const receiptWithoutHash: Omit<Receipt, "hash"> = {
		prTitle: input.prTitle,
		repo,
		timestamp: new Date().toISOString(),
		status,
		diff: input.diff ?? { additions: 0, deletions: 0, files: 0 },
		agent,
		promptVersion: {
			constitutionHash: input.constitutionHash,
			promptsHash: input.promptsHash,
		},
		checks,
		walkthrough:
			input.walkthrough ??
			"Receipt walkthrough lands in Wave 2.2 (mainahq/maina#238).",
		feedback: [],
		retries,
	};

	const hashResult = computeHash(receiptWithoutHash);
	if (!hashResult.ok) {
		return {
			ok: false,
			code: "canonicalize-failed",
			message: hashResult.message,
		};
	}

	return {
		ok: true,
		data: { ...receiptWithoutHash, hash: hashResult.data },
	};
}

function mapFinding(f: PipelineFinding): ReceiptFinding {
	return {
		severity: f.severity,
		file: f.file,
		...(f.line > 0 ? { line: f.line } : {}),
		message: f.message,
		...(f.ruleId ? { rule: f.ruleId } : {}),
	};
}

function derivePipelineStatus(
	pipeline: PipelineResult,
	checks: Check[],
): "passed" | "failed" | "partial" {
	if (pipeline.passed) return "passed";
	const anyFailed = checks.some((c) => c.status === "failed");
	return anyFailed ? "failed" : "partial";
}

/**
 * When pipeline.passed is false but no v1-mapped check captures the failure
 * (typecheck/consistency/wiki-lint/syntax-guard are dropped from v1), emit a
 * synthetic biome-check entry that records the hidden failure(s) so a red
 * receipt always points at *something* the reader can act on.
 */
function surfaceHiddenFailures(
	pipeline: PipelineResult,
	mapped: Check[],
): Check[] {
	if (pipeline.passed) return mapped;
	if (mapped.some((c) => c.status === "failed")) return mapped;

	const hiddenFailures: ReceiptFinding[] = [];

	if (pipeline.syntaxPassed === false && pipeline.syntaxErrors) {
		for (const err of pipeline.syntaxErrors) {
			hiddenFailures.push({
				severity: "error",
				file: err.file,
				...(err.line > 0 ? { line: err.line } : {}),
				message: `Syntax guard: ${err.message}`,
			});
		}
	}

	for (const tool of pipeline.tools) {
		if (TOOL_MAPPING[tool.tool] !== null) continue; // already mapped
		for (const f of tool.findings) {
			if (f.severity !== "error") continue;
			hiddenFailures.push({
				severity: "error",
				file: f.file,
				...(f.line > 0 ? { line: f.line } : {}),
				message: `${tool.tool}: ${f.message}`,
				...(f.ruleId ? { rule: f.ruleId } : {}),
			});
		}
	}

	if (hiddenFailures.length === 0) return mapped;

	return [
		...mapped,
		{
			id: "biome-check",
			name: "Pipeline (typecheck / consistency / syntax-guard)",
			status: "failed",
			tool: "biome",
			findings: hiddenFailures,
		},
	];
}
