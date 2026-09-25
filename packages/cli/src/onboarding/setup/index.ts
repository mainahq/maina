/**
 * Setup module — primitives used by the `maina setup` wizard.
 *
 * Sub-modules:
 * - `agent-files/` — tailored agent instruction file generators
 *   (AGENTS.md, CLAUDE.md, .cursor/rules/maina.mdc, etc.) and the
 *   managed-region helpers. Writing happens in `../plan.ts` + `../apply.ts`.
 * - `context.ts` — `StackContext` assembler: languages, frameworks, tooling,
 *   CI, and repo size detected from the working tree.
 * - `resolve-ai.ts` — constitution generation with degraded fallbacks.
 *
 * Only what the `setup` command consumes is re-exported here; tests import
 * sub-modules directly.
 */

export { type AgentKind, ALL_AGENTS } from "./agent-files/index";
export {
	assembleStackContext,
	type StackContext,
	summarizeRepo,
} from "./context";
export { deviceFingerprint } from "./fingerprint";
export {
	degradedBanner,
	recoveryCommand,
	type SetupDegradedReason,
} from "./recovery";
export {
	resolveSetupAI,
	type SetupAIMetadata,
	type SetupAIResult,
	type SetupAISource,
} from "./resolve-ai";
export { deploySkills } from "./skills-deploy";
export { renderFileLayoutSection, renderWorkflowSection } from "./tailor";
export {
	anonymizeStack,
	isTelemetryOptedOut,
	newSetupId,
	type SetupTelemetryEvent,
	type SetupTelemetryPhase,
	sendSetupTelemetry,
} from "./telemetry";
