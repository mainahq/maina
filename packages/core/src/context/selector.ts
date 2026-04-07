import type { BudgetMode } from "./budget.ts";

export type MainaCommand =
	| "commit"
	| "verify"
	| "context"
	| "review"
	| "plan"
	| "explain"
	| "design"
	| "ticket"
	| "analyze"
	| "pr";

export interface ContextNeeds {
	working: boolean;
	episodic: boolean | string[];
	semantic: boolean | string[];
	retrieval: boolean;
	wiki: boolean;
}

const CONTEXT_NEEDS: Record<MainaCommand, ContextNeeds> = {
	commit: {
		working: true,
		episodic: false,
		semantic: ["conventions"],
		retrieval: false,
		wiki: true,
	},
	verify: {
		working: true,
		episodic: ["recent-reviews"],
		semantic: ["adrs", "conventions"],
		retrieval: false,
		wiki: true,
	},
	context: {
		working: true,
		episodic: true,
		semantic: true,
		retrieval: true,
		wiki: true,
	},
	review: {
		working: true,
		episodic: ["past-reviews"],
		semantic: ["adrs"],
		retrieval: false,
		wiki: true,
	},
	plan: {
		working: true,
		semantic: ["adrs", "conventions"],
		episodic: false,
		retrieval: false,
		wiki: true,
	},
	explain: {
		working: true,
		episodic: false,
		semantic: true,
		retrieval: true,
		wiki: true,
	},
	design: {
		working: true,
		episodic: false,
		semantic: ["adrs"],
		retrieval: false,
		wiki: true,
	},
	ticket: {
		working: false,
		episodic: false,
		semantic: ["modules"],
		retrieval: false,
		wiki: false,
	},
	analyze: {
		working: true,
		episodic: true,
		semantic: true,
		retrieval: false,
		wiki: true,
	},
	pr: {
		working: true,
		episodic: ["past-reviews"],
		semantic: true,
		retrieval: true,
		wiki: true,
	},
};

export function getContextNeeds(command: MainaCommand): ContextNeeds {
	return CONTEXT_NEEDS[command];
}

export function needsLayer(
	needs: ContextNeeds,
	layer: "working" | "episodic" | "semantic" | "retrieval" | "wiki",
): boolean {
	const value = needs[layer];
	if (Array.isArray(value)) {
		return value.length > 0;
	}
	return value === true;
}

export function getBudgetMode(command: MainaCommand): BudgetMode {
	if (command === "commit") {
		return "focused";
	}
	if (command === "context" || command === "explain") {
		return "explore";
	}
	return "default";
}
