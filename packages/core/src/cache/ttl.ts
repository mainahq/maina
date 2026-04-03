export type TaskType =
	| "review"
	| "tests"
	| "fix"
	| "commit"
	| "context"
	| "explain"
	| "design"
	| "plan";

export interface TtlRule {
	task: TaskType;
	ttl: number;
	description: string;
}

const TTL_RULES: TtlRule[] = [
	{
		task: "review",
		ttl: 0,
		description: "Code review — cached forever, keyed by content hash",
	},
	{
		task: "tests",
		ttl: 0,
		description: "Test generation — cached forever, keyed by content hash",
	},
	{
		task: "fix",
		ttl: 0,
		description: "Bug fix — cached forever, keyed by content hash",
	},
	{
		task: "commit",
		ttl: 0,
		description: "Commit message — cached forever, keyed by content hash",
	},
	{
		task: "context",
		ttl: 3600,
		description: "Context assembly — cached for 1 hour",
	},
	{
		task: "explain",
		ttl: 86400,
		description: "Code explanation — cached for 24 hours",
	},
	{
		task: "design",
		ttl: 86400,
		description: "Design advice — cached for 24 hours",
	},
	{
		task: "plan",
		ttl: 86400,
		description: "Planning — cached for 24 hours",
	},
];

const TTL_MAP: Record<TaskType, number> = Object.fromEntries(
	TTL_RULES.map((r) => [r.task, r.ttl]),
) as Record<TaskType, number>;

export function getTtl(task: TaskType): number {
	return TTL_MAP[task] ?? 0;
}

export function isExpired(createdAt: number, ttl: number): boolean {
	if (ttl === 0) {
		return false;
	}
	return Date.now() - createdAt > ttl * 1000;
}

export function getAllRules(): TtlRule[] {
	return TTL_RULES;
}
