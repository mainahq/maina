/**
 * Implicit accept/reject signals for the RL flywheel.
 * Infers outcomes from downstream user behavior instead of requiring explicit action.
 */

import { getFeedbackDb } from "../db/index";

const DEFAULT_ACCEPT_TOOLS = ["reviewCode", "verify", "checkSlop"];

export function emitAcceptSignal(
	mainaDir: string,
	workflowId: string,
	tools?: string[],
): void {
	try {
		const dbResult = getFeedbackDb(mainaDir);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;
		const targetTools = tools ?? DEFAULT_ACCEPT_TOOLS;
		const placeholders = targetTools.map(() => "?").join(",");
		db.prepare(
			`UPDATE feedback SET accepted = 1
			 WHERE workflow_id = ?
			 AND command IN (${placeholders})`,
		).run(workflowId, ...targetTools);
	} catch {
		// Never throw from signals
	}
}

export function emitRejectSignal(
	mainaDir: string,
	tool: string,
	workflowId: string,
): void {
	try {
		const dbResult = getFeedbackDb(mainaDir);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;
		db.prepare(
			`UPDATE feedback SET accepted = 0
			 WHERE command = ? AND workflow_id = ?
			 AND id = (
				 SELECT id FROM feedback
				 WHERE command = ? AND workflow_id = ?
				 ORDER BY created_at DESC, rowid DESC LIMIT 1
			 )`,
		).run(tool, workflowId, tool, workflowId);
	} catch {
		// Never throw from signals
	}
}
