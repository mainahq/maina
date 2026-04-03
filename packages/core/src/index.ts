export const VERSION = "0.1.0";

// AI
export { generateCommitMessage } from "./ai/commit-msg";
export { generate } from "./ai/index";
export { type TryAIResult, tryAIGenerate } from "./ai/try-generate";
// AI validation
export { type AIValidationResult, validateAIOutput } from "./ai/validate";
// Cache
export {
	type CacheManager,
	type CacheStats,
	createCacheManager,
} from "./cache/manager";
// Config
export { getApiKey, isHostMode, shouldDelegateToHost } from "./config/index";
export { calculateTokens } from "./context/budget";
export {
	type AssembledContext,
	assembleContext,
	type ContextOptions,
	type LayerReport,
} from "./context/engine";
// Context — episodic
export { addEntry as addEpisodicEntry } from "./context/episodic";
export type { MainaCommand } from "./context/selector";
// Context — working
export {
	loadWorkingContext,
	saveWorkingContext,
	setVerificationResult,
	trackFile,
} from "./context/working";
// DB (Result type)
export type { Result } from "./db/index";
// Design (ADR)
export {
	type AdrSummary,
	getNextAdrNumber,
	listAdrs,
	scaffoldAdr,
} from "./design/index";
// Design Review
export {
	buildReviewContext,
	findAdrByNumber,
	type ReviewContext,
	type ReviewFinding,
	type ReviewOptions,
	type ReviewResult,
	reviewDesign,
} from "./design/review";
// Explain
export {
	type DiagramOptions,
	generateDependencyDiagram,
	generateModuleSummary,
	type ModuleSummary,
} from "./explain/index";
// Features
export {
	type AnalysisFinding,
	type AnalysisReport,
	analyze,
} from "./features/analyzer";
export {
	type CheckResult,
	type VerificationReport,
	verifyPlan,
} from "./features/checklist";
export {
	createFeatureDir,
	type DesignChoices,
	getNextFeatureNumber,
	scaffoldFeature,
	scaffoldFeatureWithContext,
} from "./features/numbering";
export { generateTestStubs } from "./features/test-stubs";
// Feedback
export {
	type FeedbackRecord,
	getFeedbackSummary,
	recordFeedback,
	recordFeedbackWithCompression,
} from "./feedback/collector";
export {
	compressReview,
	storeCompressedReview,
} from "./feedback/compress";
export {
	acknowledgeFinding,
	dismissFinding,
	getNoisyRules,
	loadPreferences,
	type Preferences,
	type RulePreference,
	savePreferences,
} from "./feedback/preferences";
// Git
export {
	type Commit,
	getBranchName,
	getChangedFiles,
	getCurrentBranch,
	getDiff,
	getRecentCommits,
	getRepoRoot,
	getStagedFiles,
	getTrackedFiles,
} from "./git/index";
// Hooks
export {
	executeHook,
	type HookContext,
	type HookEvent,
	type HookResult,
	runHooks,
	scanHooks,
} from "./hooks/index";
// Init
export {
	bootstrap,
	type InitOptions,
	type InitReport,
} from "./init/index";
export { loadDefault, type PromptTask } from "./prompts/defaults/index";
// Prompts
export {
	type BuiltPrompt,
	buildSystemPrompt,
	type FeedbackOutcome,
	getPromptStats,
	type PromptStat,
	recordOutcome,
} from "./prompts/engine";
export {
	type ABResolution,
	abTest,
	analyseFeedback,
	type CandidatePrompt,
	createCandidate,
	type FeedbackAnalysis,
	promote,
	resolveABTests,
	retire,
} from "./prompts/evolution";
// Comprehensive Review (Superpowers-style)
export {
	type ComprehensiveReviewFinding,
	type ComprehensiveReviewOptions,
	type ComprehensiveReviewResult,
	comprehensiveReview,
	type ReviewSeverity,
} from "./review/comprehensive";
// PR Review (two-stage)
export {
	type ReviewFinding as PrReviewFinding,
	type ReviewOptions as PrReviewOptions,
	type ReviewResult as PrReviewResult,
	type ReviewStageResult,
	reviewCodeQuality,
	reviewCodeQualityWithAI,
	reviewSpecCompliance,
	runTwoStageReview,
} from "./review/index";
// Stats
export {
	type CommitSnapshot,
	type ComparisonReport,
	getComparison,
	getLatest,
	getStats,
	getTrends,
	recordSnapshot,
	type SnapshotInput,
	type StatsReport,
	type TrendDirection,
	type TrendsReport,
} from "./stats/tracker";
// Ticket
export {
	buildIssueBody,
	createTicket,
	detectModules,
	type SpawnDeps,
	type TicketOptions,
	type TicketResult,
} from "./ticket/index";
// Utils
export { toKebabCase } from "./utils";
export {
	type DetectedTool,
	detectTool,
	detectTools,
	isToolAvailable,
	TOOL_REGISTRY,
	type ToolName,
} from "./verify/detect";
export {
	type DiffFilterResult,
	type Finding,
	filterByDiff,
	filterByDiffWithMap,
	parseChangedLines,
} from "./verify/diff-filter";
export {
	type FixOptions,
	type FixResult,
	type FixSuggestion,
	generateFixes,
	hashFinding,
	parseFixResponse,
} from "./verify/fix";
// Verify — Pipeline
export {
	type PipelineOptions,
	type PipelineResult,
	runPipeline,
	type ToolReport,
} from "./verify/pipeline";
export {
	detectCommentedCode,
	detectConsoleLogs,
	detectEmptyBodies,
	detectHallucinatedImports,
	detectSlop,
	detectTodosWithoutTickets,
	type SlopResult,
	type SlopRule,
} from "./verify/slop";
export {
	parseBiomeOutput,
	type SyntaxDiagnostic,
	type SyntaxGuardResult,
	syntaxGuard,
} from "./verify/syntax-guard";
