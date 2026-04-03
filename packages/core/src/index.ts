export const VERSION = "0.1.0";

// Cache
export {
	type CacheManager,
	type CacheStats,
	createCacheManager,
} from "./cache/manager";
// Config
export { isHostMode } from "./config/index";
export { calculateTokens } from "./context/budget";
export {
	type AssembledContext,
	assembleContext,
	type ContextOptions,
	type LayerReport,
} from "./context/engine";
export type { MainaCommand } from "./context/selector";
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
	abTest,
	analyseFeedback,
	type CandidatePrompt,
	createCandidate,
	type FeedbackAnalysis,
	promote,
	retire,
} from "./prompts/evolution";
// Stats
export {
	type CommitSnapshot,
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
