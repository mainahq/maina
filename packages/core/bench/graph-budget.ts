/**
 * The v1 code-graph latency budgets (FR-GRAPH-2, FR-GRAPH-4) and the pure
 * arithmetic the graph bench judges a run with. The initial index time is
 * recorded in the report but has no budget.
 */

export const GRAPH_BUDGETS = {
	/**
	 * One edited file brought up to date, dependents included. A ceiling on
	 * every sample (the issue sets no percentile for it), unlike the query
	 * budget.
	 */
	updateMs: 500,
	/** Any one query kind, against a warm store, at p95. */
	queryP95Ms: 200,
} as const;

export type Summary = Readonly<{
	count: number;
	p50: number;
	p95: number;
	max: number;
}>;

export type QueryKind = "search" | "impact" | "minimalContext";

export type BenchReport = Readonly<{
	/** `name@shortsha` of the pinned repository. */
	repo: string;
	/** Files the index holds. */
	files: number;
	/** Lines across those files. */
	loc: number;
	/** Graph size after the initial index. */
	nodes: number;
	edges: number;
	initialIndexMs: number;
	update: Summary;
	queries: Readonly<Record<QueryKind, Summary>>;
}>;

type Breach = Readonly<{
	metric: string;
	actualMs: number;
	budgetMs: number;
}>;

/** Nearest-rank percentile (`q` in 0..1); 0 for no samples. */
export function percentile(samples: readonly number[], q: number): number {
	if (samples.length === 0) return 0;
	const sorted = [...samples].sort((a, b) => a - b);
	const rank = Math.ceil(q * sorted.length) - 1;
	return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 0;
}

export function summarize(samples: readonly number[]): Summary {
	return {
		count: samples.length,
		p50: percentile(samples, 0.5),
		p95: percentile(samples, 0.95),
		max: percentile(samples, 1),
	};
}

function judge(
	metric: string,
	summary: Summary,
	budgetMs: number,
	stat: "p95" | "max",
): Breach[] {
	if (summary.count === 0) {
		return [{ metric: `${metric} samples`, actualMs: 0, budgetMs }];
	}
	return summary[stat] > budgetMs
		? [{ metric: `${metric} ${stat}`, actualMs: summary[stat], budgetMs }]
		: [];
}

const QUERY_ORDER: readonly QueryKind[] = [
	"search",
	"impact",
	"minimalContext",
];

/** Every budget the report breaks; empty when the run is within budget. */
export function checkBudgets(report: BenchReport): readonly Breach[] {
	return [
		...judge("update", report.update, GRAPH_BUDGETS.updateMs, "max"),
		...QUERY_ORDER.flatMap((kind) =>
			judge(
				`query ${kind}`,
				report.queries[kind],
				GRAPH_BUDGETS.queryP95Ms,
				"p95",
			),
		),
	];
}
