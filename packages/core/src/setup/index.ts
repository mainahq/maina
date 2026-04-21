/**
 * Setup module — primitives used by the `maina setup` wizard.
 *
 * Sub-modules:
 * - `agent-files/` — tailored agent instruction files with managed-region
 *   merges (AGENTS.md, CLAUDE.md, .cursor/rules/maina.mdc, etc.).
 * - `context.ts` — `StackContext` assembler: languages, frameworks, tooling,
 *   CI, and repo size detected from the working tree.
 * - `prompts.ts` — loader for the universal setup prompt template.
 */

export {
	adoptRules,
	detectExistingRuleFiles,
	formatProvenanceComment,
	type Rule,
	type RuleCategory,
	type RuleSourceKind,
} from "./adopt";
// Agent-files exports its own `StackContext` stub; we re-export everything
// from it and then expose the canonical `StackContext` from `./context` below,
// shadowing the stub. The stub is structurally compatible.
export * from "./agent-files/index";
export {
	type ConfirmOptions,
	type ConfirmResult,
	confirmRules,
} from "./confirm";
export {
	assembleStackContext,
	contextHash,
	type PackageManager,
	type RepoSize,
	type StackContext,
	summarizeRepo,
} from "./context";
export { deviceFingerprint } from "./fingerprint";
export {
	getUniversalPromptPath,
	loadUniversalPrompt,
	type UniversalPromptInputs,
} from "./prompts";
export {
	degradedBanner,
	recoveryCommand,
	type SetupDegradedReason,
} from "./recovery";
export {
	buildGenericConstitution,
	type ResolveAIOptions,
	resolveSetupAI,
	type SetupAIMetadata,
	type SetupAIResult,
	type SetupAISource,
} from "./resolve-ai";
export {
	type ScanReport,
	scanGitLog,
	scanLintConfig,
	scanRepo,
	scanTreeSitter,
} from "./scan/index";
export {
	buildGenericConstitutionFromInput,
	renderFileLayoutSection,
	renderWorkflowSection,
	type TailorInput,
	type TailorOutput,
	tailorConstitution,
	type ValidateResult,
	validateConstitution,
} from "./tailor";
export {
	anonymizeStack,
	isTelemetryOptedOut,
	newSetupId,
	type OptOutResult,
	type SendTelemetryOptions,
	type SetupTelemetryEvent,
	type SetupTelemetryPhase,
	type SetupTelemetryStack,
	sendSetupTelemetry,
	type TelemetryOptOutSources,
} from "./telemetry";
