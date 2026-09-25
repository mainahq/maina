/**
 * Verify Engine — Public Type Exports.
 *
 * Consolidated re-exports of all verify types for the public API surface.
 * Consumers (e.g. maina-cloud) import from here or from @mainahq/core.
 * Types are NOT duplicated — each re-exports from its source module.
 */

// BlastRadius from blast-radius (FR-VER-5, carried on PipelineResult)
export type { BlastRadius } from "./blast-radius";
// DetectedTool, ToolName from detect
export type { DetectedTool, ToolName } from "./detect";
// Finding + DiffFilterResult from diff-filter
export type { DiffFilterResult, Finding } from "./diff-filter";
// PipelineResult, PipelineOptions, ToolReport, status + scope from pipeline
export type {
	PipelineOptions,
	PipelineResult,
	ToolReport,
	VerifyScope,
	VerifyScopeKind,
	VerifyStatus,
} from "./pipeline";

// SyntaxDiagnostic, SyntaxGuardResult from syntax-guard (used in PipelineResult)
export type { SyntaxDiagnostic, SyntaxGuardResult } from "./syntax-guard";
