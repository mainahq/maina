/**
 * Implicit accept/reject signals for the RL flywheel.
 * Infers outcomes from downstream user behavior instead of requiring explicit action.
 */

import { join } from "node:path";
import { getFeedbackDb } from "../db/index";
import { recordWikiUsage } from "../wiki/signals";

const DEFAULT_ACCEPT_TOOLS = ["reviewCode", "verify", "checkSlop"];

export function emitAcceptSignal(
	mainaDir: string,
	workflowId: string,
	tools?: string[],
	wikiArticles?: string[],
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

		// Record wiki effectiveness signal for loaded articles
		if (wikiArticles && wikiArticles.length > 0) {
			const wikiDir = join(mainaDir, "wiki");
			recordWikiUsage(wikiDir, wikiArticles, "accept", true);
		}
	} catch {
		// Never throw from signals
	}
}

export function emitRejectSignal(
	mainaDir: string,
	tool: string,
	workflowId: string,
	wikiArticles?: string[],
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

		// Record wiki effectiveness signal for loaded articles
		if (wikiArticles && wikiArticles.length > 0) {
			const wikiDir = join(mainaDir, "wiki");
			recordWikiUsage(wikiDir, wikiArticles, tool, false);
		}
	} catch {
		// Never throw from signals
	}
}
