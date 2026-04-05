export const VERSION = "0.1.0";

// AI
export { generateCommitMessage } from "./ai/commit-msg";
// AI — Delegation
export {
	type DelegationRequest,
	formatDelegationRequest,
	outputDelegationRequest,
	parseDelegationRequest,
} from "./ai/delegation";
export {
	type DesignApproach,
	generateDesignApproaches,
} from "./ai/design-approaches";
export { generate } from "./ai/index";
export { generatePrSummary } from "./ai/pr-summary";
export {
	generateSpecQuestions,
	type SpecQuestion,
} from "./ai/spec-questions";
export {
	type DelegationPrompt,
	type TryAIResult,
	tryAIGenerate,
} from "./ai/try-generate";
// AI validation
export { type AIValidationResult, validateAIOutput } from "./ai/validate";
export {
	buildReport,
	buildTier3Report,
	formatComparison,
	formatTier3Comparison,
} from "./benchmark/reporter";
export { parseTestOutput, runBenchmark } from "./benchmark/runner";
export { listStories, loadStory } from "./benchmark/story-loader";
// Benchmark
export type {
	BenchmarkMetrics,
	BenchmarkReport,
	LoadedStory,
	StepMetrics,
	StoryConfig,
	Tier3Results,
	Tier3Totals,
} from "./benchmark/types";
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
	generateHldLld,
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
export { type QualityScore, scoreSpec } from "./features/quality";
export { generateTestStubs } from "./features/test-stubs";
export type {
	TaskTrace,
	TraceabilityReport,
	TraceDeps,
} from "./features/traceability";
export { traceFeature } from "./features/traceability";
// Feedback
export {
	type FeedbackRecord,
	getFeedbackSummary,
	getWorkflowId,
	recordFeedback,
	recordFeedbackAsync,
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
export {
	analyzeWorkflowTrace,
	type PromptImprovement,
	type TraceResult,
	type TraceStep,
} from "./feedback/trace-analysis";
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
	type DetectedStack,
	type InitOptions,
	type InitReport,
} from "./init/index";
// Language
export {
	detectLanguages,
	getPrimaryLanguage,
} from "./language/detect";
export {
	CSHARP_PROFILE,
	GO_PROFILE,
	getProfile,
	getSupportedLanguages,
	JAVA_PROFILE,
	type LanguageId,
	type LanguageProfile,
	PYTHON_PROFILE,
	RUST_PROFILE,
	TYPESCRIPT_PROFILE,
} from "./language/profile";
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
	analyseWorkflowFeedback,
	analyseWorkflowRuns,
	type CandidatePrompt,
	createCandidate,
	type FeedbackAnalysis,
	promote,
	resolveABTests,
	retire,
	type WorkflowRunSummary,
	type WorkflowStepAnalysis,
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
	getSkipRate,
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
// Verify — AI Review
export {
	type AIReviewOptions,
	type AIReviewResult,
	type EntityWithBody,
	type ReferencedFunction,
	resolveReferencedFunctions,
	runAIReview,
} from "./verify/ai-review";
export {
	type ConsistencyResult,
	checkConsistency,
} from "./verify/consistency";
// Verify — Coverage
export {
	type CoverageOptions,
	type CoverageResult,
	parseDiffCoverJson,
	runCoverage,
} from "./verify/coverage";
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
// Verify — Lighthouse
export {
	type LighthouseOptions,
	type LighthouseResult,
	parseLighthouseJson,
	runLighthouse,
} from "./verify/lighthouse";
// Verify — Mutation
export {
	type MutationOptions,
	type MutationResult,
	parseStrykerReport,
	runMutation,
} from "./verify/mutation";
// Verify — Pipeline
export {
	type PipelineOptions,
	type PipelineResult,
	runPipeline,
	type ToolReport,
} from "./verify/pipeline";
// Verify — Proof
export {
	formatVerificationProof,
	gatherVerificationProof,
	type ProofOptions,
	type ToolProof,
	type VerificationProof,
} from "./verify/proof";
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
// Verify — SonarQube
export {
	parseSonarReport,
	runSonar,
	type SonarOptions,
	type SonarResult,
} from "./verify/sonar";
export {
	parseBiomeOutput,
	type SyntaxDiagnostic,
	type SyntaxGuardResult,
	syntaxGuard,
} from "./verify/syntax-guard";
// Verify — Typecheck + Consistency (built-in checks)
export { runTypecheck, type TypecheckResult } from "./verify/typecheck";
// Verify — Visual
export {
	captureScreenshot,
	compareImages,
	detectWebProject,
	loadVisualConfig,
	runVisualVerification,
	type ScreenshotOptions,
	type ScreenshotResult,
	updateBaselines,
	type VisualConfig,
	type VisualDiffResult,
	type VisualVerifyResult,
} from "./verify/visual";
// Verify — ZAP DAST
export {
	parseZapJson,
	runZap,
	type ZapOptions,
	type ZapResult,
} from "./verify/zap";
// Workflow
export {
	appendWorkflowStep,
	loadWorkflowContext,
	resetWorkflowContext,
} from "./workflow/context";
