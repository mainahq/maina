export const VERSION = "0.1.0";

// Cache
export {
	type CacheManager,
	type CacheStats,
	createCacheManager,
} from "./cache/manager";
export { calculateTokens } from "./context/budget";
export {
	type AssembledContext,
	assembleContext,
	type ContextOptions,
	type LayerReport,
} from "./context/engine";
export type { MainaCommand } from "./context/selector";
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
// Verify
export {
	type DetectedTool,
	detectTool,
	detectTools,
	isToolAvailable,
	TOOL_REGISTRY,
	type ToolName,
} from "./verify/detect";
