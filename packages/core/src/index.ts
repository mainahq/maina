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
export { type AIContext, generate } from "./ai/index";
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
// Bootstrap — shared scaffolding used by the CLI's `init` and `setup`
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
export {
	type ConfigError,
	type ConfigModuleLoad,
	getApiKey,
	isHostMode,
	loadConfig,
	loadConfigModule,
	shouldDelegateToHost,
} from "./config/index";
export {
	type Config,
	type ConfigLayer,
	configJsonSchema,
	parseConfigLayer,
} from "./config/schema";
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
// Decision log migration (append-only, FR-DEC-3/5)
export {
	DECISION_LOG_MIGRATION,
	migrateDecisionLog,
} from "./db/decision-log";
// Decision outcome migration (append-only, FR-DEC-4)
export {
	DECISION_OUTCOMES_MIGRATION,
	migrateDecisionOutcomes,
} from "./db/decision-outcomes";
// Gate subject migration (what a gate decision was about, FR-GATE-8)
export { migrateGateSubjects } from "./db/gate-subjects";
// DB
export type {
	DbHandle,
	Result,
	SqlBinding,
	SqlBindings,
	SqlChanges,
	SqliteDatabase,
	SqliteStatement,
} from "./db/index";
export { getDecisionDb, getFeedbackDb } from "./db/index";
export { toDbPort } from "./db/port";
// Decide (typed decision interface, FR-DEC-1/2)
export {
	type DecidePorts,
	decide,
	defaultDecidePorts,
} from "./decide/decide";
// Drift guard (FR-DEC-8)
export {
	applyDriftAction,
	checkDrift,
	type DriftAction,
	type DriftBreach,
	type DriftMetrics,
	type DriftNotice,
	type DriftThresholds,
	driftThresholds,
} from "./decide/drift";
export {
	type LogSlice,
	readLogSlice,
	SHADOW_ACTION,
} from "./decide/evidence";
// Decision log (append-only, FR-DEC-3/5)
export {
	appendDecision,
	buildDecisionRecord,
	type DecisionLogPorts,
	type DecisionRecordInput,
} from "./decide/log/append";
export {
	canonicalJson,
	hashInput,
	hashModel,
	hashPolicy,
	hashSchema,
	hashValue,
	isHash,
} from "./decide/log/hash";
export { type DecisionFilter, queryDecisions } from "./decide/log/query";
export {
	LOG_SALT_PATH,
	type LogSaltError,
	loadLogSalt,
	logPrivacy,
} from "./decide/log/salt";
export {
	DEFAULT_LOG_PRIVACY,
	type DecisionLogError,
	type DecisionLogPrivacy,
	type DecisionRecord,
	type DecisionRecordField,
	validateRecord,
} from "./decide/log/schema";
// Decision outcomes (FR-DEC-4)
export {
	DEFAULT_HOTFIX_WINDOW,
	type MinerOptions,
	type MinerPorts,
	type MineSummary,
	mineGitOutcomes,
} from "./decide/outcomes/git-miner";
export {
	decisionsForCommit,
	linkDecisionCommit,
	linkOutcome,
	type OutcomeFilter,
	queryOutcomes,
} from "./decide/outcomes/link";
export { linkTestFailure } from "./decide/outcomes/test-signal";
export {
	type CommitDecision,
	OUTCOMES,
	type Outcome,
	type OutcomeError,
	type OutcomeInput,
	type OutcomePorts,
	type OutcomeRecord,
} from "./decide/outcomes/types";
// Shadow mode and promotion (FR-DEC-2/8)
export {
	evaluatePromotion,
	type GateResult,
	PROMOTION_METRICS,
	type PromotionEntry,
	type PromotionGate,
	type PromotionGates,
	type PromotionMetrics,
	type PromotionReport,
	type ShadowPorts,
	type ShadowRunInput,
	type ShadowRunResult,
	shadowRun,
} from "./decide/promotion";
export {
	type BackendRegistry,
	createRegistry,
	DEFAULT_REGISTRY,
	withBackend,
} from "./decide/registry";
export {
	type Answer,
	type Backend,
	type BackendAnswer,
	type BackendError,
	type BackendInput,
	type BoolQuestion,
	type ChoiceQuestion,
	type DecideError,
	type DecideRequest,
	type Decision,
	type DecisionBackend,
	type DecisionState,
	type DecisionType,
	type DistributionEntry,
	MAX_CHOICE_OPTIONS,
	type Question,
	type QuestionKind,
	type ScoreQuestion,
} from "./decide/types";
export { DECISION_CATALOG, validateQuestions } from "./decide/types-catalog";
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
	ANALYSIS_CATEGORIES,
	type AnalysisCategory,
	type AnalysisFinding,
	type AnalysisReport,
	type AnalysisSeverity,
	analyze,
	analyzeArtifacts,
	type CalibratedFinding,
	type CalibratedReport,
} from "./features/analyzer";
export {
	type CheckResult,
	type TickError,
	type TickOptions,
	type TickSource,
	tickChecklistItem,
	type UnattestedTick,
	unattestedTicks,
	type VerificationReport,
	verifyPlan,
} from "./features/checklist";
export {
	answerQuestion,
	type ClarifyAnswer,
	type ClarifyError,
	type ClarifyQuestion,
	type ClarifySession,
	type ClarifySuggestion,
	clarify,
	findClarificationMarkers,
	MAX_CLARIFY_MARKERS,
	MAX_CLARIFY_QUESTIONS,
	nextQuestion,
} from "./features/clarify";
export {
	type ConstitutionGateReport,
	constitutionGate,
	type GateRule,
	type GateViolation,
	type RuleLevel,
} from "./features/constitution-gate";
export {
	type ConvergeError,
	type ConvergeGap,
	type ConvergeReport,
	converge,
	convergeArtifacts,
	convergeCheck,
	type FeatureConvergeReport,
	GAP_TYPES,
	type GapType,
} from "./features/converge";
export {
	createFeatureDir,
	type DesignChoices,
	getNextFeatureNumber,
	scaffoldFeature,
	scaffoldFeatureWithContext,
} from "./features/numbering";
export { type QualityScore, scoreSpec } from "./features/quality";
// Spec Kit feature input (FR-SPEC-7)
export {
	listSpecKitFeatures,
	resolveSpecKitFeature,
	type SpecKitError,
	type SpecKitFacts,
	type SpecKitFeature,
} from "./features/spec-kit";
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
	type FeedbackSyncContext,
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
export {
	type CountReceiptFpsResult,
	countReceiptFpsByCheck,
	type QueryReceiptFpsOptions,
	type QueryReceiptFpsResult,
	queryReceiptFps,
	type ReceiptFpRecord,
	type RecordReceiptFpInput,
	type RecordReceiptFpResult,
	recordReceiptFp,
} from "./feedback/receipt-fp";
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
// Gate (normalised events, classification, rules engine — FR-GATE-2/4)
export type { ActionAnalysis } from "./gate/classify";
export { analyzeAction, classifyAction } from "./gate/classify";
// Gate evaluator (rules → decide → thresholds — FR-GATE-3/5/6). `GateResult`
// is re-exported as `GateEvaluation`: the promotion report owns the name here.
export {
	DEFAULT_GATE_BUDGET_MS,
	evaluateGate,
	type GatePorts,
	type GateResult as GateEvaluation,
} from "./gate/evaluate";
export type {
	FileReadAction,
	FileWriteAction,
	GateContext,
	GateEvent,
	GateEventKind,
	McpAction,
	NetworkAction,
	PermissionMode,
	ShellAction,
} from "./gate/events";
export { DEFAULT_PROTECTED_BRANCHES } from "./gate/events";
// Gate messages and recorded overrides (FR-GATE-8, FR-DEC-4)
export {
	type ConfidenceBand,
	confidenceBand,
	formatGateMessage,
} from "./gate/messages";
export {
	findGateSubject,
	type GateSubject,
	gateSubject,
	type OverrideError,
	recordGateSubject,
	recordOverride,
	rememberOverride,
	scopedAllowRules,
	withUserRules,
} from "./gate/overrides";
export type {
	ShellNode,
	ShellParser,
	ShellParserLoadError,
	ShellScript,
	ShellWord,
} from "./gate/parsers/shell";
export { loadShellParser } from "./gate/parsers/shell";
export { analyzeSql, isDestructiveSql } from "./gate/parsers/sql";
export type { RuleResult } from "./gate/rules";
export { evaluateRules, settleVerdict } from "./gate/rules";
// Git
export {
	type Commit,
	type DiffStats,
	type GetDiffStatsOptions,
	getBranchName,
	getChangedFiles,
	getCurrentBranch,
	getDiff,
	getDiffStats,
	getMergeBase,
	getRecentCommits,
	getRepoRoot,
	getRepoSlug,
	getStagedDiff,
	getStagedFiles,
	getTrackedFiles,
	parseShortstat,
	resolveBaseBranch,
} from "./git/index";
export {
	appendVerifiedByTrailer,
	computeProofHash,
	hasVerifiedByTrailer,
} from "./git/trailer";
// Graph — parser layer (FR-GRAPH-1)
export {
	type CallKind,
	detectLang as detectGraphLang,
	type ImportBinding,
	isTestPath,
	type Lang as GraphLang,
	type ParsedCall,
	type ParsedFile,
	type ParsedImport,
	type ParsedRef,
	type ParsedSymbol,
	type ParsedTest,
	type ParseError as GraphParseError,
	parseFile,
	type Span as SourceSpan,
	type SymbolKind,
	type SyntaxIssue,
} from "./graph/parse/index";
// Graph — impact, minimal context and search queries (FR-GRAPH-3, FR-GRAPH-4)
export {
	type ContextSnippet as CodeGraphContextSnippet,
	type GraphContextPorts,
	type GraphReadPorts,
	type ImpactedNode as CodeGraphImpactedNode,
	type ImpactReport as CodeGraphImpactReport,
	type ImpactRequest as CodeGraphImpactRequest,
	impact as codeGraphImpact,
	type MinimalContext as CodeGraphMinimalContext,
	type MinimalContextRequest as CodeGraphMinimalContextRequest,
	minimalContext as codeGraphMinimalContext,
	type NodeRef as CodeGraphNodeRef,
	type SearchHit as CodeGraphSearchHit,
	type SearchOptions as CodeGraphSearchOptions,
	search as searchCodeGraph,
} from "./graph/query/index";
// Graph — incremental content-hash store (FR-GRAPH-2)
// (`GraphNode`/`GraphEdge` already name the wiki graph, hence the prefix.)
export {
	type EdgeKind as CodeGraphEdgeKind,
	type GraphEdge as CodeGraphEdge,
	type GraphFile as CodeGraphFile,
	type GraphNode as CodeGraphNode,
	type GraphSnapshot as CodeGraphSnapshot,
	type GraphStoreError,
	type GraphStoreOptions,
	type GraphStorePorts,
	type GraphSyncReport,
	hasFullIndex as hasFullCodeGraphIndex,
	indexRepo,
	type NodeKind as CodeGraphNodeKind,
	readGraph as readCodeGraph,
	updateFiles,
} from "./graph/store/index";
// Graph — the store's real adapters, for the runtime's graph hooks
export {
	type OpenedGraph as OpenedCodeGraph,
	type OpenGraphError as OpenCodeGraphError,
	openCodeGraph,
	systemFs,
} from "./graph/system";
// Hooks
export {
	executeHook,
	type HookContext,
	type HookEvent,
	type HookResult,
	runHooks,
	scanHooks,
} from "./hooks/index";
// Language
export {
	detectFileLanguage,
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
// Policy (gate policy schema, FR-GATE-9)
export type { ActionClass } from "./policy/defaults";
export {
	DEFAULT_POLICY,
	DENIED_ACTION_CLASSES,
	IRREVERSIBLE_ACTION_CLASSES,
} from "./policy/defaults";
export { loadPolicy, readUserPolicy, userPolicyFile } from "./policy/load";
export {
	type Policy,
	type PolicyError,
	type PolicyLayer,
	parsePolicyLayer,
	policyJsonSchema,
	type RulePolicy,
	VERDICTS,
	type Verdict,
} from "./policy/schema";
// Ports (functional core side-effect boundary)
export type {
	ClockPort,
	CorePorts,
	DbError,
	DbPort,
	DbRow,
	DbValue,
	EnvPort,
	FsError,
	FsPort,
	GitError,
	GitPort,
	LogFields,
	LoggerPort,
	LogLevel,
	ModelError,
	ModelPort,
	ModelRequest,
	ModelResponse,
	NetworkError,
	NetworkPort,
	NetworkRequest,
	ProcessEnv,
	ProcessError,
	ProcessOutput,
	ProcessPort,
	SpawnOptions,
} from "./ports/index";
// Process: the system ProcessPort adapter (#420, #433)
export { stripRepoLocalGitEnv, systemProcess } from "./process/index";
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
	extractPatchDestinations,
	extractPatchFiles,
	type FeedbackEntry as ReceiptFeedbackEntry,
	type Finding as ReceiptFinding,
	generateWalkthrough,
	type IndexEntry as ReceiptIndexEntry,
	type IndexPageOptions as ReceiptIndexPageOptions,
	type IndexPageResult as ReceiptIndexPageResult,
	type Patch as ReceiptPatch,
	type PromptVersion as ReceiptPromptVersion,
	type Receipt,
	type ReceiptStatus,
	renderIndexHtml as renderReceiptIndexHtml,
	renderReceiptHtml,
	type ValidatePatchResult,
	type VerifyErrorCode as ReceiptVerifyErrorCode,
	type VerifyResult as ReceiptVerifyResult,
	validatePatchScope,
	verifyReceipt,
	type WalkthroughDeps,
	type WalkthroughInput,
	type WalkthroughResult,
	writeIndexPage as writeReceiptIndexPage,
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
// Session summary of gate and routing outcomes (FR-RET-2)
export {
	formatSessionSummary,
	type RoutingCosts,
	type SessionSummary,
	type SummaryOptions,
	summarise,
} from "./session/summary";
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
	type PayloadOptions,
	type SendOptions,
	sendCliErrorReport,
} from "./telemetry/cli-error-reporter";
// Collection consent and the privacy report (FR-PRIV-1..3)
export {
	type ChannelConsent,
	type CollectionConfig,
	type ConsentError,
	type ConsentSource,
	isChannelEnabled,
	type KillSwitch,
	loadCollectionConfig,
	TELEMETRY_CHANNELS,
	type TelemetryChannel,
	type TelemetryContext,
} from "./telemetry/consent";
// Opt-in outcome sharing (FR-DEC-7)
export {
	buildOutcomeSharePayload,
	OUTCOME_SHARE_VERSION,
	type OutcomeShareError,
	type OutcomeSharePayload,
	type OutcomeSharePorts,
	type SharedDecision,
	type ShareOptions,
	type ShareResult,
	shareOutcomes,
	validateOutcomeSharePayload,
} from "./telemetry/outcome-share";
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
// Verify — Ignore
export {
	DEFAULT_IGNORE_DIRS,
	DEFAULT_IGNORE_SUFFIXES,
	type FilterIgnoredResult,
	filterIgnoredFiles,
	isIgnored,
	loadMainaIgnore,
} from "./verify/ignore";
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
// Verify — Wiki lint (for `maina wiki lint`; verify runs it via the pipeline)
export { runWikiLint } from "./verify/tools/wiki-lint";
// Verify — Typecheck + Consistency (built-in checks)
export { runTypecheck, type TypecheckResult } from "./verify/typecheck";
// Verify — Public Type Surface (consolidated for external consumers like maina-cloud)
export type {
	BlastRadius,
	DetectedTool,
	DiffFilterResult,
	Finding,
	PipelineOptions,
	PipelineResult,
	SyntaxDiagnostic,
	SyntaxGuardResult,
	ToolName,
	ToolReport,
	VerifyScope,
	VerifyScopeKind,
	VerifyStatus,
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
// Version — the one source the runtime reads (generated by scripts/version-source.ts)
export { VERSION } from "./version";
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
