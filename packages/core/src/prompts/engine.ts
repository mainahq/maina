import { hashContent } from "../cache/keys";
import { getFeedbackDb } from "../db/index";
import { loadDefault, type PromptTask } from "./defaults/index";
import { abTest } from "./evolution";
import {
	loadConstitution,
	loadUserOverride,
	mergePrompts,
	renderTemplate,
} from "./loader";

export interface BuiltPrompt {
	prompt: string;
	hash: string;
}

export interface FeedbackOutcome {
	accepted: boolean;
	command: string;
	context?: string;
}

export interface PromptStat {
	promptHash: string;
	totalUsage: number;
	acceptRate: number;
}

/**
 * Assembles a full system prompt for a given task.
 * Loads default template, applies user overrides, injects constitution,
 * renders template variables, and returns the prompt with its content hash.
 */
export async function buildSystemPrompt(
	task: string,
	mainaDir: string,
	variables: Record<string, string> = {},
): Promise<BuiltPrompt> {
	// Load constitution (always injected)
	const constitution = await loadConstitution(mainaDir);

	// Load default prompt template
	const defaultPrompt = await loadDefault(task as PromptTask);

	// A/B test: check if a candidate prompt should be used (20% traffic)
	const abResult = abTest(mainaDir, task);
	if (abResult.variant === "candidate" && abResult.hash) {
		// Candidate selected — load its content from prompt_versions
		const dbResult = getFeedbackDb(mainaDir);
		if (dbResult.ok) {
			const row = dbResult.value.db
				.query("SELECT content FROM prompt_versions WHERE hash = ? LIMIT 1")
				.get(abResult.hash) as { content: string } | null;
			if (row?.content) {
				const allVariables: Record<string, string> = {
					constitution,
					...variables,
				};
				const prompt = renderTemplate(row.content, allVariables);
				return { prompt, hash: hashContent(prompt) };
			}
		}
	}

	// Load user override from .maina/prompts/<task>.md
	const userOverride = await loadUserOverride(mainaDir, task);

	// Merge: user overrides replace default entirely if present
	const merged = mergePrompts(defaultPrompt, userOverride);

	// Render template variables — constitution is always available
	const allVariables: Record<string, string> = {
		constitution,
		...variables,
	};
	const prompt = renderTemplate(merged, allVariables);

	return {
		prompt,
		hash: hashContent(prompt),
	};
}

/**
 * Records a prompt outcome (accepted/rejected) to the feedback database.
 * Used to drive prompt evolution via the `maina learn` command.
 */
export function recordOutcome(
	mainaDir: string,
	promptHash: string,
	outcome: FeedbackOutcome,
): void {
	const dbResult = getFeedbackDb(mainaDir);
	if (!dbResult.ok) return;

	const { db } = dbResult.value;
	const id = `${promptHash}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

	db.prepare(
		`INSERT INTO feedback (id, prompt_hash, command, accepted, context, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	).run(
		id,
		promptHash,
		outcome.command,
		outcome.accepted ? 1 : 0,
		outcome.context ?? null,
		new Date().toISOString(),
	);
}

/**
 * Returns per-prompt-hash statistics: total usage and accept rate.
 */
export function getPromptStats(mainaDir: string): PromptStat[] {
	const dbResult = getFeedbackDb(mainaDir);
	if (!dbResult.ok) return [];

	const { db } = dbResult.value;

	const rows = db
		.query(
			`SELECT prompt_hash, COUNT(*) as total, SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted_count
			 FROM feedback GROUP BY prompt_hash`,
		)
		.all() as Array<{
		prompt_hash: string;
		total: number;
		accepted_count: number;
	}>;

	return rows.map((row) => ({
		promptHash: row.prompt_hash,
		totalUsage: row.total,
		acceptRate: row.total > 0 ? row.accepted_count / row.total : 0,
	}));
}
