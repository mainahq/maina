/**
 * The runtime the MCP server is a surface over (FR-MCP-1, FR-MCP-4).
 *
 * Every tool resolves its repository root through `resolveRoot` and then
 * calls one capability with explicit inputs: an absolute root plus
 * repo-relative `files`/`paths` or a `query`. Nothing in a tool reads the
 * process working directory; the caller that builds the runtime decides
 * where the default root comes from (`systemRuntime` for the CLI, the
 * runtime package's root resolution for the standalone binary). Tests
 * inject a fake.
 */

import type {
	AnalysisReport,
	CodeGraphImpactReport,
	CodeGraphMinimalContext,
	DecideRequest,
	Decision,
	PipelineResult,
	PrReviewResult,
	ReceiptVerifyResult,
	Result,
} from "@mainahq/core";

/**
 * Why a capability could not answer. `no_root`: no usable repository root;
 * `invalid_input`: the arguments cannot be served (a path outside the root,
 * a malformed request); `not_found`: a named file or directory is missing;
 * `failed`: the capability itself failed.
 */
export type RuntimeError =
	| Readonly<{ kind: "no_root"; message: string }>
	| Readonly<{ kind: "invalid_input"; message: string }>
	| Readonly<{ kind: "not_found"; path: string; message: string }>
	| Readonly<{ kind: "failed"; message: string }>;

/**
 * The absolute repository root for a call: `explicit` when the caller
 * passed one, else the runtime's default. An error when neither names a
 * usable repository.
 */
export type RootResolver = (
	explicit: string | undefined,
) => Promise<Result<string, RuntimeError>>;

export type VerifyRequest = Readonly<{
	root: string;
	/** Repo-relative files; omitted means the staged files at `root`. */
	files?: readonly string[];
	/** Base ref for the diff-only filter. */
	base?: string;
}>;

export type DecideCall = Readonly<{ root: string; request: DecideRequest }>;

export type ImpactCall = Readonly<{
	root: string;
	files?: readonly string[];
	symbols?: readonly string[];
	depth?: number;
}>;

export type ContextCall = Readonly<{
	root: string;
	files?: readonly string[];
	query?: string;
	budgetTokens: number;
	depth?: number;
}>;

export type ReviewCall = Readonly<{
	root: string;
	/** A unified diff; when omitted the runtime diffs `files` against `base`. */
	diff?: string;
	files?: readonly string[];
	base?: string;
	planContent?: string;
}>;

export type ReviewOutcome = Readonly<{
	result: PrReviewResult;
	/** True when the AI stage handed the review back to the host. */
	delegated: boolean;
}>;

/** Repo-relative `paths` under an absolute `root`. */
export type PathsCall = Readonly<{ root: string; paths: readonly string[] }>;

export type SpecReport = Readonly<{ path: string; report: AnalysisReport }>;

export type ReceiptCheck = Readonly<{
	path: string;
	result:
		| ReceiptVerifyResult
		| Readonly<{ ok: false; code: "io"; message: string }>;
}>;

export type RepoStatus = Readonly<{
	graphIndexed: boolean;
	wikiInitialized: boolean;
	/** Why the repo policy did not load; empty when it did. */
	policyErrors: readonly string[];
}>;

export type WikiArticleRef = Readonly<{
	path: string;
	type: string;
	title: string;
}>;

export type WikiAnswer = Readonly<{
	answer: string;
	sources: readonly string[];
}>;

/** DeepWiki-compatible wiki reads, only reachable through the allow-list. */
export type WikiCapabilities = Readonly<{
	ask: (
		call: Readonly<{ root: string; question: string }>,
	) => Promise<Result<WikiAnswer, RuntimeError>>;
	structure: (
		call: Readonly<{ root: string }>,
	) => Promise<Result<readonly WikiArticleRef[], RuntimeError>>;
	/** `page` is relative to the wiki directory and already checked to stay in it. */
	contents: (
		call: Readonly<{ root: string; page: string }>,
	) => Promise<Result<string, RuntimeError>>;
}>;

export type McpRuntime = Readonly<{
	version: string;
	resolveRoot: RootResolver;
	verify: (
		call: VerifyRequest,
	) => Promise<Result<PipelineResult, RuntimeError>>;
	decide: (
		call: DecideCall,
	) => Promise<Result<readonly Decision[], RuntimeError>>;
	impact: (
		call: ImpactCall,
	) => Promise<Result<CodeGraphImpactReport, RuntimeError>>;
	context: (
		call: ContextCall,
	) => Promise<Result<CodeGraphMinimalContext, RuntimeError>>;
	review: (call: ReviewCall) => Promise<Result<ReviewOutcome, RuntimeError>>;
	specCheck: (
		call: PathsCall,
	) => Promise<Result<readonly SpecReport[], RuntimeError>>;
	receipts: (
		call: PathsCall,
	) => Promise<Result<readonly ReceiptCheck[], RuntimeError>>;
	status: (
		call: Readonly<{ root: string }>,
	) => Promise<Result<RepoStatus, RuntimeError>>;
	wiki: WikiCapabilities;
}>;
