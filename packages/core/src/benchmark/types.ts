export interface StoryConfig {
	name: string;
	description: string;
	tier: number;
	source: string;
	testFiles: string[];
	/** Hidden validation tests — not shown to AI during implementation */
	validationFiles?: string[];
	metrics: {
		expectedTests: number;
		expectedValidationTests?: number;
		originalLOC: number;
		complexity: "easy" | "medium" | "hard";
	};
}

export interface BenchmarkMetrics {
	pipeline: "maina" | "speckit";
	storyName: string;
	wallClockMs: number;
	tokensInput: number;
	tokensOutput: number;
	testsTotal: number;
	testsPassed: number;
	testsFailed: number;
	verifyFindings: number;
	specQualityScore: number;
	// Extended metrics from tier 1 learnings
	implLOC: number;
	attemptsToPass: number;
	bugsIntroduced: number;
	toolsUsed: string[];
	stepTimings?: Record<string, number>;
}

export interface BenchmarkReport {
	story: StoryConfig;
	maina: BenchmarkMetrics | null;
	speckit: BenchmarkMetrics | null;
	timestamp: string;
	winner: "maina" | "speckit" | "tie" | "incomplete";
}

export interface LoadedStory {
	config: StoryConfig;
	specContent: string;
	testFiles: Array<{ name: string; content: string }>;
	storyDir: string;
}

export interface StepMetrics {
	name: string;
	durationMs: number;
	tokensInput: number;
	tokensOutput: number;
	artifacts: string[];
	// Optional per-step data
	questionsAsked?: number;
	testsGenerated?: number;
	approachesProposed?: number;
	loc?: number;
	attempts?: number;
	findings?: number;
	findingsBySeverity?: Record<string, number>;
	issuesFound?: number;
	passed?: boolean;
}

export interface Tier3Totals {
	durationMs: number;
	tokensInput: number;
	tokensOutput: number;
	bugsIntroduced: number;
	bugsCaught: number;
	testsPassed: number;
	testsTotal: number;
	/** Validation-only metrics (hidden tests, not shown during implementation) */
	validationPassed?: number;
	validationTotal?: number;
}

export interface Tier3Results {
	story: StoryConfig;
	timestamp: string;
	maina: {
		steps: Record<string, StepMetrics>;
		totals: Tier3Totals;
	};
	speckit: {
		steps: Record<string, StepMetrics>;
		totals: Tier3Totals;
	};
	winner: "maina" | "speckit" | "tie" | "incomplete";
	learnings: string[];
}
