export type BudgetMode = "focused" | "default" | "explore";

export interface BudgetAllocation {
	working: number;
	episodic: number;
	semantic: number;
	retrieval: number;
	wiki: number;
	total: number;
	headroom: number; // reserved for AI reasoning
}

export interface LayerContent {
	name: string;
	text: string;
	tokens: number;
	priority: number; // lower = higher priority (working=0, semantic=1, episodic=2, retrieval=3)
}

const DEFAULT_MODEL_CONTEXT_WINDOW = 200_000;

/**
 * Approximate token count: ~1 token per 3.5 characters.
 */
export function calculateTokens(text: string): number {
	if (text.length === 0) return 0;
	return Math.ceil(text.length / 3.5);
}

/**
 * Returns the fraction of the model context window available for layer content.
 * The remainder is reserved as headroom for AI reasoning.
 */
export function getBudgetRatio(mode: BudgetMode): number {
	switch (mode) {
		case "focused":
			return 0.4;
		case "default":
			return 0.6;
		case "explore":
			return 0.8;
	}
}

/**
 * Calculates per-layer token allocations for a given mode and model context window.
 *
 * Layer proportions within the usable budget:
 *   working:   ~12%
 *   episodic:  ~12%
 *   semantic:  ~16%
 *   retrieval: ~8%  (remainder after the above four)
 *   wiki:      ~12%
 */
export function assembleBudget(
	mode: BudgetMode,
	modelContextWindow: number = DEFAULT_MODEL_CONTEXT_WINDOW,
): BudgetAllocation {
	const ratio = getBudgetRatio(mode);
	const budget = Math.floor(modelContextWindow * ratio);
	const headroom = modelContextWindow - budget;

	const working = Math.floor(budget * 0.12);
	const episodic = Math.floor(budget * 0.12);
	const semantic = Math.floor(budget * 0.16);
	const wiki = Math.floor(budget * 0.12);
	// retrieval gets the exact remainder so all layer tokens sum to budget
	const retrieval = budget - working - episodic - semantic - wiki;

	return {
		working,
		semantic,
		episodic,
		retrieval,
		wiki,
		headroom,
		total: modelContextWindow,
	};
}

/**
 * Trims layers so the total token count fits within the budget.
 * Drops lowest-priority layers first (retrieval → episodic → semantic).
 * The working layer (priority 0) is never removed.
 *
 * Returns the surviving layers in ascending priority order.
 */
export function truncateToFit(
	layers: LayerContent[],
	budget: BudgetAllocation,
): LayerContent[] {
	// Sort by priority ascending so highest-priority layers come first
	const sorted = [...layers].sort((a, b) => a.priority - b.priority);

	const totalTokens = sorted.reduce((sum, l) => sum + l.tokens, 0);
	if (totalTokens <= budget.total) {
		return sorted;
	}

	// Drop layers from lowest priority (highest numeric value) until we fit,
	// but never drop priority-0 (working) layers.
	const mutable = [...sorted];
	let current = totalTokens;

	while (current > budget.total) {
		// Find the lowest-priority non-working layer
		let dropIndex = -1;
		let maxPriority = -1;
		for (let i = 0; i < mutable.length; i++) {
			const layer = mutable[i];
			if (
				layer !== undefined &&
				layer.priority > 0 &&
				layer.priority > maxPriority
			) {
				maxPriority = layer.priority;
				dropIndex = i;
			}
		}

		if (dropIndex === -1) {
			// Only working layers remain — stop
			break;
		}

		const dropped = mutable[dropIndex];
		if (dropped !== undefined) {
			current -= dropped.tokens;
		}
		mutable.splice(dropIndex, 1);
	}

	return mutable;
}
