/**
 * Receipt verification — structural validation + hash re-computation.
 *
 * Offline-only: no hosted schema fetch. Pinned to the types in ./types.ts.
 */

import { createHash } from "node:crypto";
import { canonicalize } from "./canonical";
import type { Receipt } from "./types";

const HEX64 = /^[0-9a-f]{64}$/;
const REPO_FORMAT = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ISO_8601 =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const CHECK_STATUSES: ReadonlyArray<string> = ["passed", "failed", "skipped"];
const RECEIPT_STATUSES: ReadonlyArray<string> = ["passed", "failed", "partial"];
const CHECK_TOOLS: ReadonlyArray<string> = [
	"biome",
	"semgrep",
	"sonar",
	"trivy",
	"secretlint",
	"diff-cover",
	"stryker",
	"slop",
	"review-spec",
	"review-quality",
	"tests",
	"visual",
	"doc-claims",
];
const SEVERITIES: ReadonlyArray<string> = ["info", "warning", "error"];

export type VerifyResult =
	| { ok: true; data: Receipt }
	| { ok: false; code: VerifyErrorCode; message: string };

export type VerifyErrorCode =
	| "not-object"
	| "missing-field"
	| "invalid-field"
	| "invalid-hash-format"
	| "hash-mismatch"
	| "canonicalize-failed";

/**
 * Compute the canonical sha256 hash for a receipt payload (minus the `hash`
 * field). Returns a Result — if the payload contains unsupported JS types
 * (bigint, symbol, NaN, Infinity) canonicalization fails and the error is
 * surfaced structurally rather than thrown.
 */
export function computeHash(
	receipt: Omit<Receipt, "hash">,
):
	| { ok: true; data: string }
	| { ok: false; code: "canonicalize-failed"; message: string } {
	const c = canonicalize(receipt);
	if (!c.ok) {
		return { ok: false, code: "canonicalize-failed", message: c.message };
	}
	return { ok: true, data: createHash("sha256").update(c.data).digest("hex") };
}

export function verifyReceipt(raw: unknown): VerifyResult {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return {
			ok: false,
			code: "not-object",
			message: "Receipt must be a JSON object",
		};
	}
	const shape = validateShape(raw);
	if (!shape.ok) return shape;

	const receipt = raw as Receipt;
	const { hash: declaredHash, ...rest } = receipt;
	const hashResult = computeHash(rest as Omit<Receipt, "hash">);
	if (!hashResult.ok) {
		return {
			ok: false,
			code: "canonicalize-failed",
			message: hashResult.message,
		};
	}
	if (declaredHash !== hashResult.data) {
		return {
			ok: false,
			code: "hash-mismatch",
			message: `Hash mismatch: receipt declares ${declaredHash}, canonical re-hash is ${hashResult.data}`,
		};
	}
	return { ok: true, data: receipt };
}

function validateShape(
	raw: object,
): { ok: true } | { ok: false; code: VerifyErrorCode; message: string } {
	const r = raw as Record<string, unknown>;
	const required = [
		"prTitle",
		"repo",
		"timestamp",
		"status",
		"hash",
		"diff",
		"agent",
		"promptVersion",
		"checks",
		"walkthrough",
		"feedback",
		"retries",
	];
	for (const k of required) {
		if (!(k in r)) {
			return {
				ok: false,
				code: "missing-field",
				message: `Missing required field: ${k}`,
			};
		}
	}

	if (typeof r.prTitle !== "string" || r.prTitle.length === 0) {
		return invalid("prTitle", "non-empty string");
	}
	if (typeof r.repo !== "string" || !REPO_FORMAT.test(r.repo)) {
		return invalid("repo", "owner/name string");
	}
	if (
		typeof r.timestamp !== "string" ||
		!ISO_8601.test(r.timestamp) ||
		Number.isNaN(Date.parse(r.timestamp))
	) {
		return invalid("timestamp", "ISO 8601 string");
	}
	if (typeof r.status !== "string" || !RECEIPT_STATUSES.includes(r.status)) {
		return invalid("status", `one of ${RECEIPT_STATUSES.join(", ")}`);
	}
	if (typeof r.hash !== "string" || !HEX64.test(r.hash)) {
		return {
			ok: false,
			code: "invalid-hash-format",
			message: "hash must be 64 lowercase hex chars",
		};
	}
	if (typeof r.walkthrough !== "string") {
		return invalid("walkthrough", "string");
	}
	if (
		typeof r.retries !== "number" ||
		!Number.isInteger(r.retries) ||
		r.retries < 0
	) {
		return invalid("retries", "non-negative integer");
	}

	const diffErr = validateDiff(r.diff);
	if (diffErr) return diffErr;
	const agentErr = validateAgent(r.agent);
	if (agentErr) return agentErr;
	const pvErr = validatePromptVersion(r.promptVersion);
	if (pvErr) return pvErr;
	const checksErr = validateChecks(r.checks);
	if (checksErr) return checksErr;
	const fbErr = validateFeedback(r.feedback);
	if (fbErr) return fbErr;

	return { ok: true };
}

function invalid(field: string, expect: string) {
	return {
		ok: false as const,
		code: "invalid-field" as const,
		message: `${field} must be ${expect}`,
	};
}

function validateDiff(v: unknown) {
	if (typeof v !== "object" || v === null) return invalid("diff", "object");
	const d = v as Record<string, unknown>;
	for (const k of ["additions", "deletions", "files"]) {
		if (
			typeof d[k] !== "number" ||
			!Number.isInteger(d[k] as number) ||
			(d[k] as number) < 0
		) {
			return invalid(`diff.${k}`, "non-negative integer");
		}
	}
	return null;
}

function validateAgent(v: unknown) {
	if (typeof v !== "object" || v === null) return invalid("agent", "object");
	const a = v as Record<string, unknown>;
	if (typeof a.id !== "string" || a.id.length === 0)
		return invalid("agent.id", "non-empty string");
	if (typeof a.modelVersion !== "string" || a.modelVersion.length === 0) {
		return invalid("agent.modelVersion", "non-empty string");
	}
	return null;
}

function validatePromptVersion(v: unknown) {
	if (typeof v !== "object" || v === null)
		return invalid("promptVersion", "object");
	const p = v as Record<string, unknown>;
	for (const k of ["constitutionHash", "promptsHash"]) {
		if (typeof p[k] !== "string" || !HEX64.test(p[k] as string)) {
			return invalid(`promptVersion.${k}`, "64 lowercase hex chars");
		}
	}
	return null;
}

function validateChecks(v: unknown) {
	if (!Array.isArray(v)) return invalid("checks", "array");
	for (let i = 0; i < v.length; i++) {
		const c = v[i] as Record<string, unknown>;
		if (typeof c !== "object" || c === null)
			return invalid(`checks[${i}]`, "object");
		for (const k of ["id", "name", "status", "tool", "findings"]) {
			if (!(k in c))
				return {
					ok: false as const,
					code: "missing-field" as const,
					message: `checks[${i}].${k} missing`,
				};
		}
		if (typeof c.id !== "string" || c.id.length === 0)
			return invalid(`checks[${i}].id`, "non-empty string");
		if (typeof c.name !== "string" || c.name.length === 0)
			return invalid(`checks[${i}].name`, "non-empty string");
		if (typeof c.status !== "string" || !CHECK_STATUSES.includes(c.status)) {
			return invalid(
				`checks[${i}].status`,
				`one of ${CHECK_STATUSES.join(", ")}`,
			);
		}
		if (typeof c.tool !== "string" || !CHECK_TOOLS.includes(c.tool)) {
			return invalid(`checks[${i}].tool`, `one of the CheckTool enum`);
		}
		if (!Array.isArray(c.findings))
			return invalid(`checks[${i}].findings`, "array");
		for (let j = 0; j < c.findings.length; j++) {
			const f = c.findings[j] as Record<string, unknown>;
			if (typeof f !== "object" || f === null)
				return invalid(`checks[${i}].findings[${j}]`, "object");
			if (typeof f.severity !== "string" || !SEVERITIES.includes(f.severity)) {
				return invalid(
					`checks[${i}].findings[${j}].severity`,
					`one of ${SEVERITIES.join(", ")}`,
				);
			}
			if (typeof f.file !== "string")
				return invalid(`checks[${i}].findings[${j}].file`, "string");
			if (typeof f.message !== "string")
				return invalid(`checks[${i}].findings[${j}].message`, "string");
			if (
				f.line !== undefined &&
				(typeof f.line !== "number" || !Number.isInteger(f.line) || f.line < 1)
			) {
				return invalid(
					`checks[${i}].findings[${j}].line`,
					"positive integer when present",
				);
			}
			if (f.rule !== undefined && typeof f.rule !== "string") {
				return invalid(
					`checks[${i}].findings[${j}].rule`,
					"string when present",
				);
			}
		}
		if (c.patch !== undefined) {
			const p = c.patch as Record<string, unknown>;
			if (typeof p !== "object" || p === null)
				return invalid(`checks[${i}].patch`, "object");
			if (typeof p.diff !== "string")
				return invalid(`checks[${i}].patch.diff`, "string");
			if (typeof p.rationale !== "string" || p.rationale.length === 0) {
				return invalid(`checks[${i}].patch.rationale`, "non-empty string");
			}
		}
	}
	return null;
}

function validateFeedback(v: unknown) {
	if (!Array.isArray(v)) return invalid("feedback", "array");
	for (let i = 0; i < v.length; i++) {
		const f = v[i] as Record<string, unknown>;
		if (typeof f !== "object" || f === null)
			return invalid(`feedback[${i}]`, "object");
		if (typeof f.checkId !== "string" || f.checkId.length === 0)
			return invalid(`feedback[${i}].checkId`, "non-empty string");
		if (typeof f.reason !== "string" || f.reason.length === 0)
			return invalid(`feedback[${i}].reason`, "non-empty string");
		if (
			typeof f.constitutionHash !== "string" ||
			!HEX64.test(f.constitutionHash)
		) {
			return invalid(
				`feedback[${i}].constitutionHash`,
				"64 lowercase hex chars",
			);
		}
	}
	return null;
}
