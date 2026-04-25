/**
 * Receipt false-positive feedback — record + query.
 *
 * Q7 (locked 2026-04-25): feedback is keyed by `constitutionHash`, not by
 * repo or by receipt hash. Two repos sharing the same constitution share
 * their FP knowledge; a constitution edit resets the FP set (because the
 * rules changed). The optional `receipt_hash` column lets us trace a FP
 * back to the receipt it was filed against without making it the key.
 *
 * Pure storage — Result-typed, no throws. Persists to `.maina/feedback.db`.
 */

import { randomUUID } from "node:crypto";
import { getFeedbackDb } from "../db/index";

const HEX64 = /^[0-9a-f]{64}$/;

export interface ReceiptFpRecord {
	id: string;
	receiptHash: string | null;
	checkId: string;
	reason: string;
	constitutionHash: string;
	createdAt: string;
}

export interface RecordReceiptFpInput {
	checkId: string;
	reason: string;
	constitutionHash: string;
	receiptHash?: string;
	mainaDir?: string;
}

export type RecordReceiptFpResult =
	| { ok: true; data: ReceiptFpRecord }
	| {
			ok: false;
			code: "invalid-check-id" | "invalid-reason" | "invalid-hash" | "io";
			message: string;
	  };

export type QueryReceiptFpsResult =
	| { ok: true; data: ReceiptFpRecord[] }
	| { ok: false; code: "io"; message: string };

interface FpRow {
	id: string;
	receipt_hash: string | null;
	check_id: string;
	reason: string;
	constitution_hash: string;
	created_at: string;
}

export function recordReceiptFp(
	input: RecordReceiptFpInput,
): RecordReceiptFpResult {
	if (!input.checkId || input.checkId.trim().length === 0) {
		return {
			ok: false,
			code: "invalid-check-id",
			message: "checkId is required",
		};
	}
	if (!input.reason || input.reason.trim().length === 0) {
		return {
			ok: false,
			code: "invalid-reason",
			message: "reason is required",
		};
	}
	if (!HEX64.test(input.constitutionHash)) {
		return {
			ok: false,
			code: "invalid-hash",
			message: `constitutionHash must be 64 lowercase hex chars, got: ${input.constitutionHash}`,
		};
	}
	if (input.receiptHash !== undefined && !HEX64.test(input.receiptHash)) {
		return {
			ok: false,
			code: "invalid-hash",
			message: `receiptHash, when provided, must be 64 lowercase hex chars`,
		};
	}

	const record: ReceiptFpRecord = {
		id: randomUUID(),
		receiptHash: input.receiptHash ?? null,
		checkId: input.checkId.trim(),
		reason: input.reason.trim(),
		constitutionHash: input.constitutionHash,
		createdAt: new Date().toISOString(),
	};

	try {
		const handle = getFeedbackDb(input.mainaDir ?? ".maina");
		if (!handle.ok) {
			return {
				ok: false,
				code: "io",
				message: `Failed to open feedback DB: ${handle.error}`,
			};
		}
		const db = handle.value.db;
		db.run(
			`INSERT INTO receipt_feedback
				(id, receipt_hash, check_id, reason, constitution_hash, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
			[
				record.id,
				record.receiptHash,
				record.checkId,
				record.reason,
				record.constitutionHash,
				record.createdAt,
			],
		);
	} catch (e) {
		return {
			ok: false,
			code: "io",
			message: `Failed to record FP: ${e instanceof Error ? e.message : String(e)}`,
		};
	}

	return { ok: true, data: record };
}

export interface QueryReceiptFpsOptions {
	constitutionHash?: string;
	checkId?: string;
	mainaDir?: string;
}

export function queryReceiptFps(
	options: QueryReceiptFpsOptions = {},
): QueryReceiptFpsResult {
	if (
		options.constitutionHash !== undefined &&
		!HEX64.test(options.constitutionHash)
	) {
		return {
			ok: false,
			code: "io",
			message: `constitutionHash must be 64 lowercase hex chars, got: ${options.constitutionHash}`,
		};
	}

	try {
		const handle = getFeedbackDb(options.mainaDir ?? ".maina");
		if (!handle.ok) {
			return {
				ok: false,
				code: "io",
				message: `Failed to open feedback DB: ${handle.error}`,
			};
		}
		const db = handle.value.db;
		const conditions: string[] = [];
		const params: string[] = [];
		if (options.constitutionHash) {
			conditions.push("constitution_hash = ?");
			params.push(options.constitutionHash);
		}
		if (options.checkId) {
			conditions.push("check_id = ?");
			params.push(options.checkId.trim());
		}
		const where =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const rows = db
			.query<FpRow, string[]>(
				`SELECT id, receipt_hash, check_id, reason, constitution_hash, created_at
				FROM receipt_feedback
				${where}
				ORDER BY created_at DESC`,
			)
			.all(...params);
		return {
			ok: true,
			data: rows.map(rowToRecord),
		};
	} catch (e) {
		return {
			ok: false,
			code: "io",
			message: `Failed to query FPs: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

/** Aggregate per-check FP counts for a given constitution. Useful for the
 * preferences "noisy rule" detector. */
export function countReceiptFpsByCheck(
	constitutionHash: string,
	mainaDir?: string,
): Map<string, number> {
	const result = queryReceiptFps({ constitutionHash, mainaDir });
	if (!result.ok) return new Map();
	const counts = new Map<string, number>();
	for (const r of result.data) {
		counts.set(r.checkId, (counts.get(r.checkId) ?? 0) + 1);
	}
	return counts;
}

function rowToRecord(row: FpRow): ReceiptFpRecord {
	return {
		id: row.id,
		receiptHash: row.receipt_hash,
		checkId: row.check_id,
		reason: row.reason,
		constitutionHash: row.constitution_hash,
		createdAt: row.created_at,
	};
}
