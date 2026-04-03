export interface StoryConfig {
	name: string;
	description: string;
	tier: number;
	source: string;
	testFiles: string[];
	metrics: {
		expectedTests: number;
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
