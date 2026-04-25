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
	| {
			ok: false;
			code: "invalid-hash" | "invalid-check-id" | "io";
			message: string;
	  };

export type CountReceiptFpsResult =
	| { ok: true; data: Map<string, number> }
	| { ok: false; code: "invalid-hash" | "io"; message: string };

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
	const checkId = input.checkId?.trim();
	const reason = input.reason?.trim();
	const constitutionHash = input.constitutionHash?.trim();
	const receiptHash =
		input.receiptHash !== undefined ? input.receiptHash.trim() : undefined;

	if (!checkId) {
		return {
			ok: false,
			code: "invalid-check-id",
			message: "checkId is required",
		};
	}
	if (!reason) {
		return {
			ok: false,
			code: "invalid-reason",
			message: "reason is required",
		};
	}
	if (!constitutionHash || !HEX64.test(constitutionHash)) {
		return {
			ok: false,
			code: "invalid-hash",
			message: `constitutionHash must be 64 lowercase hex chars, got: ${constitutionHash ?? "<empty>"}`,
		};
	}
	if (receiptHash !== undefined && !HEX64.test(receiptHash)) {
		return {
			ok: false,
			code: "invalid-hash",
			message: "receiptHash, when provided, must be 64 lowercase hex chars",
		};
	}

	const record: ReceiptFpRecord = {
		id: randomUUID(),
		receiptHash: receiptHash ?? null,
		checkId,
		reason,
		constitutionHash,
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
	const constitutionHash = options.constitutionHash?.trim();
	if (constitutionHash !== undefined && !HEX64.test(constitutionHash)) {
		return {
			ok: false,
			code: "invalid-hash",
			message: `constitutionHash must be 64 lowercase hex chars, got: ${constitutionHash || "<empty>"}`,
		};
	}

	let checkId: string | undefined;
	if (options.checkId !== undefined) {
		const trimmed = options.checkId.trim();
		if (trimmed.length === 0) {
			return {
				ok: false,
				code: "invalid-check-id",
				message: "checkId filter cannot be whitespace-only",
			};
		}
		checkId = trimmed;
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
		if (constitutionHash) {
			conditions.push("constitution_hash = ?");
			params.push(constitutionHash);
		}
		if (checkId) {
			conditions.push("check_id = ?");
			params.push(checkId);
		}
		const where =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		// Tie-break on `id` so two FPs filed in the same millisecond keep a
		// stable order — `created_at` alone isn't unique enough.
		const rows = db
			.query<FpRow, string[]>(
				`SELECT id, receipt_hash, check_id, reason, constitution_hash, created_at
				FROM receipt_feedback
				${where}
				ORDER BY created_at DESC, id DESC`,
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
 * preferences "noisy rule" detector. Returns a Result so DB failures don't
 * masquerade as "no FPs recorded". */
export function countReceiptFpsByCheck(
	constitutionHash: string,
	mainaDir?: string,
): CountReceiptFpsResult {
	const trimmed = constitutionHash?.trim();
	if (!trimmed || !HEX64.test(trimmed)) {
		return {
			ok: false,
			code: "invalid-hash",
			message: `constitutionHash must be 64 lowercase hex chars, got: ${trimmed || "<empty>"}`,
		};
	}

	try {
		const handle = getFeedbackDb(mainaDir ?? ".maina");
		if (!handle.ok) {
			return {
				ok: false,
				code: "io",
				message: `Failed to open feedback DB: ${handle.error}`,
			};
		}
		// Aggregate in SQL — avoids materializing every row in memory just to
		// count it.
		const rows = handle.value.db
			.query<{ check_id: string; n: number }, string[]>(
				`SELECT check_id, COUNT(*) AS n
				FROM receipt_feedback
				WHERE constitution_hash = ?
				GROUP BY check_id`,
			)
			.all(trimmed);
		const counts = new Map<string, number>();
		for (const r of rows) counts.set(r.check_id, Number(r.n));
		return { ok: true, data: counts };
	} catch (e) {
		return {
			ok: false,
			code: "io",
			message: `Failed to count FPs: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
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
