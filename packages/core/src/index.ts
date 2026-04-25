export const VERSION = "0.1.0";

// AI
export { type AIAvailability, checkAIAvailability } from "./ai/availability";
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
// Bootstrap — shared scaffolding used by `init` and `setup`
export {
	COMMIT_PROMPT_TEMPLATE,
	CONFIG_YML_STUB,
	CONSTITUTION_STUB,
	REVIEW_PROMPT_TEMPLATE,
	type ScaffoldOptions,
	type ScaffoldReport,
	scaffold,
} from "./bootstrap/index";
// Cache
export {
	type CacheManager,
	type CacheStats,
	createCacheManager,
} from "./cache/manager";
// Cloud
export {
	type AuthConfig,
	clearAuthConfig,
	exchangeGitHubToken,
	GITHUB_CLIENT_ID,
	loadAuthConfig,
	pollForToken,
	pollGitHubToken,
	saveAuthConfig,
	startDeviceFlow,
	startGitHubDeviceFlow,
} from "./cloud/auth";
export { type CloudClient, createCloudClient } from "./cloud/client";
export type {
	ApiResponse,
	CloudConfig,
	CloudEpisodicEntry,
	CloudFeedbackPayload,
	CloudPromptImprovement,
	DeviceCodeResponse,
	EpisodicCloudEntry,
	FeedbackBatchPayload,
	FeedbackEvent,
	FeedbackImprovementsResponse,
	GitHubDeviceCodeResponse,
	GitHubExchangeResponse,
	GitHubTokenResponse,
	PromptRecord,
	SubmitVerifyPayload,
	TeamInfo,
	TeamMember,
	TokenResponse,
	VerifyFinding,
	VerifyResultResponse,
	VerifyStatusResponse,
} from "./cloud/types";
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
// DB
export type { Result } from "./db/index";
export { getFeedbackDb } from "./db/index";
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
// Errors
export {
	formatErrorForCli,
	formatErrorForMcp,
	generateErrorId,
	generateErrorIdFromString,
} from "./errors/error-id";
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
export {
	buildToolCacheKey,
	type CaptureInput,
	captureResult,
	getCachedResult,
} from "./feedback/capture";
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
	ALLOWED_REVIEWERS,
	type CategoryByFile,
	categoriseComment,
	classifyReviewerKind,
	type ExternalReviewComment,
	type ExternalReviewFinding,
	type FindingCategory,
	type FindingState,
	getTopCategoriesByFile,
	type IngestPrReviewsOptions,
	type IngestStats,
	type InsertFindingInput,
	ingestComments,
	ingestPrReviews,
	insertFinding,
	isAutoSummaryComment,
	parsePaginatedJson,
	type QueryFindingsOptions,
	queryFindings,
	type ReviewerKind,
} from "./feedback/external-reviews";
export {
	acknowledgeFinding,
	dismissFinding,
	getNoisyRules,
	loadPreferences,
	type Preferences,
	type RulePreference,
	savePreferences,
} from "./feedback/preferences";
export { emitAcceptSignal, emitRejectSignal } from "./feedback/signals";
export {
	exportEpisodicForCloud,
	exportFeedbackForCloud,
	exportWorkflowStats,
	type WorkflowStats,
} from "./feedback/sync";
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
	getRepoSlug,
	getStagedFiles,
	getTrackedFiles,
} from "./git/index";
export {
	appendVerifiedByTrailer,
	computeProofHash,
	hasVerifiedByTrailer,
} from "./git/trailer";
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
	buildMainaSection,
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
export { buildMainaEntry, MAINA_MCP_KEY } from "./mcp/entry";
// MCP install/remove across clients
export {
	type ApplyResult,
	buildClientRegistry,
	type ListEntry,
	listClientIds,
	type McpClientId,
	type McpClientInfo,
	type McpScope,
	type RunOptions,
	type RunReport,
	runAdd,
	runList,
	runRemove,
} from "./mcp/index";
export {
	detectLauncher,
	isDirectBinary,
	type Launcher,
	resetLauncherCache,
} from "./mcp/launcher";
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
// Receipt
export {
	AGENT_ID_PATTERN,
	type Agent as ReceiptAgent,
	type AgentIdentity,
	type BuildReceiptInput,
	type BuildReceiptResult,
	baselineWalkthrough,
	buildReceipt,
	type Check as ReceiptCheck,
	type CheckStatus as ReceiptCheckStatus,
	type CheckTool as ReceiptCheckTool,
	canonicalize as canonicalizeReceipt,
	computeHash as computeReceiptHash,
	type DetectAgentOptions,
	type Diff as ReceiptDiff,
	deriveChecksAndStatus,
	detectAgent,
	type FeedbackEntry as ReceiptFeedbackEntry,
	type Finding as ReceiptFinding,
	generateWalkthrough,
	type Patch as ReceiptPatch,
	type PromptVersion as ReceiptPromptVersion,
	type Receipt,
	type ReceiptStatus,
	renderReceiptHtml,
	type VerifyErrorCode as ReceiptVerifyErrorCode,
	type VerifyResult as ReceiptVerifyResult,
	verifyReceipt,
	type WalkthroughDeps,
	type WalkthroughInput,
	type WalkthroughResult,
} from "./receipt";
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
// Setup (wizard primitives)
export {
	type AgentKind,
	ALL_AGENTS,
	adoptRules,
	anonymizeStack,
	assembleStackContext,
	buildGenericConstitution,
	buildGenericConstitutionFromInput,
	type ConfirmOptions,
	type ConfirmResult,
	type CursorMcpEntry,
	confirmRules,
	contextHash,
	type DeploySkillsOptions,
	type DeploySkillsReport,
	degradedBanner,
	deploySkills,
	detectExistingRuleFiles,
	deviceFingerprint,
	extractManaged,
	formatProvenanceComment,
	generateAgentsMd,
	generateClaudeMd,
	generateCopilotInstructions,
	generateCursorRules,
	generateWindsurfRules,
	getUniversalPromptPath,
	isTelemetryOptedOut,
	loadUniversalPrompt,
	MAINA_REGION_END,
	MAINA_REGION_START,
	type MainaMcpEntry,
	type MergeJsonKeyedOptions,
	type MergeJsonKeyedResult,
	mergeJsonKeyed,
	mergeManaged,
	newSetupId,
	type OptOutResult,
	type PackageManager,
	type RepoSize,
	type ResolveAIOptions,
	type Rule,
	type RuleCategory,
	type RuleSourceKind,
	recoveryCommand,
	renderFileLayoutSection,
	renderWorkflowSection,
	resolveSetupAI,
	type ScanReport,
	type SendTelemetryOptions,
	type SetupAIMetadata,
	type SetupAIResult,
	type SetupAISource,
	type SetupDegradedReason,
	type SetupTelemetryEvent,
	type SetupTelemetryPhase,
	type SetupTelemetryStack,
	type StackContext,
	scanGitLog,
	scanLintConfig,
	scanRepo,
	scanTreeSitter,
	sendSetupTelemetry,
	summarizeRepo,
	type TailorInput,
	type TailorOutput,
	type TelemetryOptOutSources,
	tailorConstitution,
	type UniversalPromptInputs,
	type ValidateResult,
	validateConstitution,
	type WriteClaudeSettingsAction,
	type WriteClaudeSettingsOptions,
	type WriteClaudeSettingsReport,
	type WriteCursorMcpAction,
	type WriteCursorMcpOptions,
	type WriteCursorMcpReport,
	wrapManaged,
	writeAllAgentFiles,
	writeClaudeMd,
	writeClaudeSettings,
	writeCursorMcp,
} from "./setup/index";
// Stats
export {
	type CommitSnapshot,
	type ComparisonReport,
	getComparison,
	getLatest,
	getSkipRate,
	getStats,
	getToolUsageStats,
	getTrends,
	recordSnapshot,
	type SnapshotInput,
	type StatsReport,
	type ToolUsageInput,
	type ToolUsageStats,
	type TrendDirection,
	type TrendsReport,
	trackToolUsage,
} from "./stats/tracker";
// CLI crash telemetry
export {
	buildCliErrorPayload,
	type CliErrorPayload,
	isCliTelemetryOptedOut,
	type SendOptions,
	sendCliErrorReport,
} from "./telemetry/cli-error-reporter";
// PostHog send path (feat 054)
export {
	captureError,
	captureUsage,
	createPosthogClient,
	flushTelemetry,
	type PosthogClient,
	type PosthogClientOptions,
	type PosthogFactory,
	type PosthogLike,
} from "./telemetry/posthog-client";
export {
	buildErrorEvent,
	type ErrorEvent,
	type ErrorEventContext,
	isErrorReportingEnabled,
	reportError,
} from "./telemetry/reporter";
export {
	buildUsageEvent,
	isTelemetryEnabled,
	type UsageEvent,
	type UsageEventName,
} from "./telemetry/usage";
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
	detectTool,
	detectTools,
	getToolsForLanguages,
	isToolAvailable,
	TOOL_REGISTRY,
	type ToolRegistryEntry,
	type ToolTier,
} from "./verify/detect";
export {
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
export { runPipeline } from "./verify/pipeline";
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
	syntaxGuard,
} from "./verify/syntax-guard";
// Verify — Typecheck + Consistency (built-in checks)
export { runTypecheck, type TypecheckResult } from "./verify/typecheck";
// Verify — Public Type Surface (consolidated for external consumers like maina-cloud)
export type {
	DetectedTool,
	DiffFilterResult,
	Finding,
	PipelineOptions,
	PipelineResult,
	SyntaxDiagnostic,
	SyntaxGuardResult,
	ToolName,
	ToolReport,
} from "./verify/types";
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
// Wiki — Community detection (Leiden by default, Louvain opt-in via option)
export {
	type CommunitiesResult,
	type CommunityAlgorithm,
	type DetectOptions,
	detectCommunities,
} from "./wiki/communities";
// Wiki — Compiler
export {
	type CompilationResult as WikiCompilationResult,
	type CompileOptions as WikiCompileOptions,
	compile as compileWiki,
} from "./wiki/compiler";
// Wiki — Consult
export {
	consultWikiForBrainstorm,
	consultWikiForDesign,
	consultWikiForPlan,
	type WikiBrainstormContext,
	type WikiConsultResult,
	type WikiDesignConsultResult,
} from "./wiki/consult";
// Wiki — Exporters
export {
	type ExportFormat,
	type ExportResult,
	exportCypher,
	exportGraph,
	exportGraphMl,
	exportObsidian,
} from "./wiki/export";
export { type CodeEntity, extractCodeEntities } from "./wiki/extractors/code";
export {
	extractDecisions,
	extractSingleDecision,
} from "./wiki/extractors/decision";
export {
	extractFeatures,
	extractSingleFeature,
} from "./wiki/extractors/feature";
export { extractWorkflowTrace } from "./wiki/extractors/workflow";
// Wiki — Graph
export {
	buildKnowledgeGraph,
	computePageRank,
	type GraphEdge,
	type GraphNode,
	type KnowledgeGraph,
	mapToArticles,
} from "./wiki/graph";
// Wiki — Indexer
export { generateIndex } from "./wiki/indexer";
// Wiki — Linker
export { generateLinks, type LinkResult } from "./wiki/linker";
// Wiki — Louvain (legacy direct access; prefer `detectCommunities` + algorithm option)
export {
	detectCommunities as detectCommunitiesLouvain,
	type LouvainNode,
	type LouvainResult,
} from "./wiki/louvain";
// Wiki — Query
export {
	queryWiki,
	type WikiQueryOptions,
	type WikiQueryResult,
} from "./wiki/query";
export {
	DEFAULT_SCHEMA,
	getArticleMaxLength,
	getLinkSyntax,
	validateArticleStructure,
	type WikiSchema,
} from "./wiki/schema";
// Wiki — Search
export {
	buildSearchIndex,
	loadSearchIndex,
	saveSearchIndex,
	searchWiki,
	type WikiSearchIndex,
	type WikiSearchResult,
} from "./wiki/search";
// Wiki — Signals
export {
	type ArticleLoadSignal,
	type CompilationPromptSignal,
	calculateEbbinghausScore,
	getPromptEffectiveness,
	getWikiEffectivenessReport,
	recordArticlesLoaded,
	recordWikiUsage,
	type WikiEffectivenessReport,
	type WikiEffectivenessSignal,
} from "./wiki/signals";
export {
	createEmptyState,
	getChangedFiles as getWikiChangedFiles,
	hashContent,
	hashFile,
	loadState as loadWikiState,
	saveState as saveWikiState,
} from "./wiki/state";
// Wiki — Tracking
export {
	trackWikiRefsRead,
	trackWikiRefsWritten,
} from "./wiki/tracking";
// Wiki
export type {
	ArticleType,
	DecisionStatus,
	EdgeType,
	ExtractedDecision,
	ExtractedFeature,
	ExtractedWorkflowTrace,
	RLSignal,
	TaskItem,
	WikiArticle,
	WikiLink,
	WikiLintCheck,
	WikiLintFinding,
	WikiLintResult,
	WikiState,
	WorkflowStep as WikiWorkflowStep,
} from "./wiki/types";
export { DECAY_HALF_LIVES } from "./wiki/types";
// Workflow
export {
	appendWikiRefs,
	appendWorkflowStep,
	loadWorkflowContext,
	resetWorkflowContext,
} from "./workflow/context";
