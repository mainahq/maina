/**
 * Verify Pipeline Orchestrator — ties together all verification tools.
 *
 * Pipeline flow:
 * 1. Resolve the scope: the provided list, or the changed files in the
 *    working tree (default) / index (`scope: "staged"`) / branch range
 * 2. Run syntax guard FIRST — abort immediately if it fails
 * 3. Auto-detect available tools
 * 3b. Read the change's blast radius from the code graph (FR-VER-5): the
 *    type checker also runs on the dependents, and `tests` runs the tests
 *    covering the change and its callers
 * 4. Run all available tools in PARALLEL (slop, builtin, semgrep, trivy, secretlint)
 * 5. Collect all findings
 * 6. Apply diff-only filter (unless diffOnly === false); type errors in
 *    the change's callers and failing affected tests survive it
 * 6b. Triage the findings through `decide`: noise suppressed at the
 *    policy's `finding.real` threshold, severity from `finding.severity`
 *    (#329)
 * 6c. Triage the diff (`diff.needs_review`): the AI review goes deep only
 *    when it says so or `deep` is set; its entities come from the graph
 * 7. Status: failed on any error finding; passed only when a tool actually
 *    ran on a file in scope; otherwise skipped (#328)
 * 8. Return unified PipelineResult
 */

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { createCacheManager } from "../cache/manager";
import { type DecidePorts, defaultDecidePorts } from "../decide/decide";
import { loadPreferences } from "../feedback/preferences";
import { getDiff, resolveBaseBranch } from "../git/index";
import { resolveScopeFiles, type ScopeKind } from "../git/scope";
import type { GraphContextPorts } from "../graph/query/types";
import { codeGraphDbPath, openCodeGraph } from "../graph/system";
import { detectLanguages } from "../language/detect";
import type { LanguageId } from "../language/profile";
import { getProfile, isCodeFile } from "../language/profile";
import { envFromRecord } from "../ports/env";
import type { CorePorts } from "../ports/index";
import { systemProcess } from "../process/index";
import { type AIReviewResult, runAIReview } from "./ai-review";
import {
	type BlastRadius,
	computeBlastRadius,
	typecheckScope,
} from "./blast-radius";
import { runBuiltinChecks } from "./builtin";
import { checkConsistency } from "./consistency";
import { runCoverage } from "./coverage";
import type { DetectedTool } from "./detect";
import { detectTools } from "./detect";
import type { Finding } from "./diff-filter";
import { filterByDiff } from "./diff-filter";
import { filterIgnoredFiles } from "./ignore";
import { runMutation } from "./mutation";
import { type EntityWithBody, graphReviewEntities } from "./review-entities";
import { runSecretlint } from "./secretlint";
import { runSemgrep } from "./semgrep";
import { detectSlop } from "./slop";
import { runSonar } from "./sonar";
import type { SyntaxDiagnostic } from "./syntax-guard";
import { syntaxGuard } from "./syntax-guard";
import { detectDocClaims } from "./tools/doc-claims";
import {
	AFFECTED_TESTS_TOOL,
	runAffectedTests,
	selectAffectedTests,
} from "./tools/tests";
import { runWikiLintTool } from "./tools/wiki-lint-runner";
import {
	runsDeepReview,
	type Triage,
	triageDiff,
	triageFindings,
} from "./triage";
import { runTrivy } from "./trivy";
import { runTypecheck, type SpawnEnv } from "./typecheck";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ToolReport {
	tool: string;
	findings: Finding[];
	skipped: boolean;
	duration: number; // ms
	/** Why a detected tool was skipped anyway, e.g. it could not be started (#389). */
	notice?: string;
}

/**
 * `passed` needs evidence: no error findings AND at least one tool that ran
 * on a file in scope. An empty scope, or one no tool could check, is
 * `skipped`, never `passed` (#328, FR-VER-2).
 */
export type VerifyStatus = "passed" | "failed" | "skipped";

/** `files` when the caller pinned the list (e.g. `--all`, MCP, backfill). */
export type VerifyScopeKind = ScopeKind | "files";

export interface VerifyScope {
	readonly kind: VerifyScopeKind;
	/** Files checked, after bundled/minified artifacts are dropped. */
	readonly files: readonly string[];
}

export interface PipelineResult {
	status: VerifyStatus;
	/** `status === "passed"`. Kept for existing callers. */
	passed: boolean;
	scope: VerifyScope;
	syntaxPassed: boolean; // syntax guard result
	syntaxErrors?: SyntaxDiagnostic[];
	tools: ToolReport[]; // per-tool results
	findings: Finding[]; // all shown findings (after diff filter)
	hiddenCount: number; // pre-existing findings hidden
	detectedTools: DetectedTool[]; // what was found on PATH
	duration: number; // total ms
	cacheHits: number; // cache L1+L2 hits during this run
	cacheMisses: number; // cache misses during this run
	/**
	 * The review triage (`diff.needs_review`), when the pipeline got as far
	 * as the AI review (#329). The receipt records it.
	 */
	triage?: Triage;
	/**
	 * What the change can break, from the code graph (FR-VER-5); absent
	 * when there is no graph store.
	 */
	blastRadius?: BlastRadius;
}

export interface PipelineOptions {
	files?: string[]; // specific files (default: the `scope`'s changed files)
	/**
	 * Which changed files to check when `files` is not given: the working
	 * tree vs the base, staged + unstaged + untracked (default), the index
	 * only (`staged`, the pre-#328 behaviour), or `base...HEAD` (`range`).
	 */
	scope?: ScopeKind;
	baseBranch?: string; // for diff filter (default: resolveBaseBranch)
	diffOnly?: boolean; // default: true
	/** Force the standard-tier AI review; the triage can also ask for it (#329). */
	deep?: boolean;
	/** Repository root (explicit; core never reads the process cwd). */
	cwd: string;
	mainaDir?: string;
	languages?: string[]; // override language detection
	/**
	 * Environment for the built-in type checker, injected by the caller (it
	 * gets `NO_COLOR=1` on top), and for the AI review's key/host detection
	 * (without one the AI review sees no key and is skipped). Other runners
	 * inherit the parent environment through the process port.
	 */
	env?: SpawnEnv;
	/**
	 * Starts the pipeline's tool processes (syntax guard, tool detection,
	 * external runners, type checker, wiki lint). Callers pass
	 * `CorePorts.process`; the system adapter when omitted. Git reads (base
	 * branch, staged files, the diff filter) go through the git module's
	 * `GitPort`, not this port.
	 */
	process?: CorePorts["process"];
	/**
	 * Policy and backends for the findings and review triage (#329). The
	 * built-in policy and backends when omitted.
	 */
	decide?: DecidePorts;
	/**
	 * Code-graph ports the blast radius and the AI review's entities are
	 * read from. When omitted the store under `mainaDir` is opened if it
	 * exists; without one the checks stay on the changed files and the
	 * review gets no entities.
	 */
	graph?: GraphContextPorts;
	/**
	 * Run the tests the graph selects for the change (its blast radius),
	 * plus changed test files (FR-VER-5). Off by default.
	 */
	tests?: boolean;
}

// ─── Tool Runner Helpers ──────────────────────────────────────────────────

/**
 * Run a single tool and wrap the result in a ToolReport with timing.
 */
async function runToolWithTiming(
	toolName: string,
	fn: () => Promise<{ findings: Finding[]; skipped: boolean; notice?: string }>,
): Promise<ToolReport> {
	const start = performance.now();
	const result = await fn();
	const duration = Math.round(performance.now() - start);

	return {
		tool: toolName,
		findings: result.findings,
		skipped: result.skipped,
		duration,
		...(result.notice ? { notice: result.notice } : {}),
	};
}

const absolute = (cwd: string, file: string): string =>
	isAbsolute(file) ? file : join(cwd, file);

/**
 * Tools that check the files in scope themselves. Repo-wide scanners
 * (trivy, sonarqube, stryker, diff-cover, wiki-lint), the conditional
 * doc-claims/consistency passes and the AI review are no evidence that a
 * changed file was checked.
 */
const FILE_EVIDENCE_TOOLS: ReadonlySet<string> = new Set([
	"builtin",
	"slop",
	"semgrep",
	"secretlint",
	"typecheck",
]);

/**
 * `report` with each finding replaced by its triaged copy, and the ones the
 * noise filter suppressed dropped. Findings the triage never saw (hidden by
 * the diff filter) are kept as they are.
 */
function withTriaged(
	report: ToolReport,
	triaged: ReadonlyMap<Finding, Finding | null>,
): ToolReport {
	const findings = report.findings.flatMap((finding) => {
		const t = triaged.get(finding);
		if (t === undefined) return [finding];
		return t === null ? [] : [t];
	});
	return { ...report, findings };
}

/**
 * `read` over the code graph: `graph` when given, else the store under
 * `mainaDir` when there is one. No store, or any failure, is `fallback`,
 * never a failed run.
 */
async function fromGraph<T>(
	graph: GraphContextPorts | undefined,
	mainaDir: string,
	fallback: T,
	read: (ports: GraphContextPorts) => Promise<T>,
): Promise<T> {
	if (graph) return read(graph);
	// Opening the store creates it; verify never should.
	if (!existsSync(codeGraphDbPath(mainaDir))) return fallback;
	const opened = openCodeGraph(mainaDir);
	if (!opened.ok) return fallback;
	try {
		return await read(opened.value.ports);
	} catch {
		return fallback;
	} finally {
		opened.value.close();
	}
}

/** The graph symbols `diff` calls, for the AI review. */
async function reviewEntities(
	graph: GraphContextPorts | undefined,
	mainaDir: string,
	cwd: string,
	diff: string,
): Promise<readonly EntityWithBody[]> {
	if (!diff.trim()) return [];
	return fromGraph(graph, mainaDir, [], async (ports) => {
		const result = await graphReviewEntities(ports, cwd, diff);
		return result.ok ? result.value : [];
	});
}

/** What changing `files` can break, or undefined without a graph. */
function blastRadius(
	graph: GraphContextPorts | undefined,
	mainaDir: string,
	files: readonly string[],
): Promise<BlastRadius | undefined> {
	return fromGraph<BlastRadius | undefined>(
		graph,
		mainaDir,
		undefined,
		async (ports) => {
			const result = computeBlastRadius(ports, files);
			return result.ok ? result.value : undefined;
		},
	);
}

/** failed on any error finding; passed only with evidence; else skipped. */
function deriveStatus(
	findings: readonly Finding[],
	reports: readonly ToolReport[],
): VerifyStatus {
	if (findings.some((f) => f.severity === "error")) return "failed";
	const ranOnScope = reports.some(
		(r) => FILE_EVIDENCE_TOOLS.has(r.tool) && !r.skipped,
	);
	return ranOnScope ? "passed" : "skipped";
}

// ─── Pipeline ─────────────────────────────────────────────────────────────

/**
 * Run the full verification pipeline.
 *
 * Orchestrates: syntax guard -> tool detection -> parallel tool execution
 * -> diff-only filtering -> unified result.
 */
export async function runPipeline(
	options: PipelineOptions,
): Promise<PipelineResult> {
	const start = performance.now();
	const cwd = options.cwd;
	const diffOnly = options.diffOnly !== false; // default: true
	const processPort = options.process ?? systemProcess;
	const baseBranch = await resolveBaseBranch(cwd, options.baseBranch);

	// ── Step 1: Resolve the scope ─────────────────────────────────────────
	const scopeKind: VerifyScopeKind = options.files
		? "files"
		: (options.scope ?? "working-tree");
	const rawFiles =
		options.files ??
		(await resolveScopeFiles(options.scope ?? "working-tree", {
			cwd,
			base: baseBranch,
		}));

	// Filter out bundled/minified artifacts (dist/, build/, *.min.js, etc.)
	// before any tool sees them. Running pattern-based slop detection on a
	// committed ncc/esbuild bundle produces tens of thousands of false
	// positives — broke `maina verify` on the GitHub-Action repo shape
	// (#207).
	const { kept: files } = filterIgnoredFiles(rawFiles, cwd);
	const scope: VerifyScope = { kind: scopeKind, files };

	// Empty scope → nothing was verified, so nothing passed
	if (files.length === 0) {
		return {
			status: "skipped",
			passed: false,
			scope,
			syntaxPassed: true,
			tools: [],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: Math.round(performance.now() - start),
			cacheHits: 0,
			cacheMisses: 0,
		};
	}

	// ── Step 2: Syntax guard (MUST run first) ─────────────────────────────
	// Detect languages or use provided override
	const languages = options.languages ?? detectLanguages(cwd);
	const primaryLang = (languages[0] ?? "typescript") as LanguageId;
	const profile = getProfile(primaryLang);
	const syntaxResult = await syntaxGuard(files, cwd, profile, processPort);

	if (!syntaxResult.ok) {
		return {
			status: "failed",
			passed: false,
			scope,
			syntaxPassed: false,
			syntaxErrors: syntaxResult.error,
			tools: [],
			findings: [],
			hiddenCount: 0,
			detectedTools: [],
			duration: Math.round(performance.now() - start),
			cacheHits: 0,
			cacheMisses: 0,
		};
	}

	// ── Step 3: Auto-detect tools ─────────────────────────────────────────
	const detectedTools = await detectTools(cwd, undefined, processPort);

	// ── Step 3b: Blast radius from the code graph (FR-VER-5) ─────────────
	// Resolve against the explicit root, never the process cwd.
	const mainaDir = options.mainaDir ?? join(cwd, ".maina");
	const radius = await blastRadius(options.graph, mainaDir, files);

	// ── Step 4: Run all available tools in PARALLEL ───────────────────────
	// Build a lookup from detection results to avoid redundant subprocess
	// spawns. Runners get the resolved command too: detection may have found
	// the tool only in <root>/node_modules/.bin, which the bare name misses.
	const detectedByName = new Map<string, DetectedTool>();
	for (const t of detectedTools) {
		detectedByName.set(t.name, t);
	}
	const resolvedTool = (
		name: string,
	): {
		available: boolean;
		command?: string;
		process: CorePorts["process"];
	} => {
		const t = detectedByName.get(name);
		return t
			? { available: t.available, command: t.command, process: processPort }
			: { available: false, process: processPort };
	};

	const toolPromises: Promise<ToolReport>[] = [];

	// Slop detector always runs (no external tool dependency), cache-aware
	const slopCache = createCacheManager(mainaDir);
	// Slop only reads source files that exist; with none it checked nothing.
	const slopHasInput = files.some(
		(file) => isCodeFile(file) && existsSync(absolute(cwd, file)),
	);
	toolPromises.push(
		runToolWithTiming("slop", async () => {
			const result = await detectSlop(files, { cwd, cache: slopCache });
			return { findings: result.findings, skipped: !slopHasInput };
		}),
	);

	// Doc-claims — verifies that import statements in changed markdown docs
	// reference symbols actually exported by the resolved package source.
	// Mechanical, no LLM. See packages/core/src/verify/tools/doc-claims.ts.
	toolPromises.push(
		runToolWithTiming("doc-claims", async () => {
			const result = await detectDocClaims(files, { cwd });
			return { findings: result.findings, skipped: false };
		}),
	);

	// Semgrep — pass pre-resolved availability
	toolPromises.push(
		runToolWithTiming("semgrep", () =>
			runSemgrep({
				files,
				cwd,
				...resolvedTool("semgrep"),
			}),
		),
	);

	// Trivy — pass pre-resolved availability
	toolPromises.push(
		runToolWithTiming("trivy", () =>
			runTrivy({ cwd, ...resolvedTool("trivy") }),
		),
	);

	// Secretlint — pass pre-resolved availability
	toolPromises.push(
		runToolWithTiming("secretlint", () =>
			runSecretlint({
				files,
				cwd,
				...resolvedTool("secretlint"),
			}),
		),
	);

	// SonarQube — pass pre-resolved availability
	toolPromises.push(
		runToolWithTiming("sonarqube", () =>
			runSonar({
				cwd,
				...resolvedTool("sonarqube"),
			}),
		),
	);

	// Stryker mutation testing — pass pre-resolved availability
	toolPromises.push(
		runToolWithTiming("stryker", () =>
			runMutation({
				cwd,
				...resolvedTool("stryker"),
			}),
		),
	);

	// diff-cover — pass pre-resolved availability
	toolPromises.push(
		runToolWithTiming("diff-cover", () =>
			runCoverage({
				baseBranch,
				cwd,
				...resolvedTool("diff-cover"),
			}),
		),
	);

	// Built-in checks (always run, no external tool dependency). The type
	// checker sees the dependents too, so a caller broken by the change is
	// checked even in another workspace project (FR-VER-5).
	toolPromises.push(
		runToolWithTiming("typecheck", async () => {
			const result = await runTypecheck(typecheckScope(files, radius), cwd, {
				language: primaryLang,
				env: options.env,
				process: processPort,
			});
			return { findings: result.findings, skipped: result.skipped };
		}),
	);

	toolPromises.push(
		runToolWithTiming("consistency", async () => {
			const result = await checkConsistency(files, cwd, mainaDir);
			return { findings: result.findings, skipped: false };
		}),
	);

	// Built-in checks (always run, pure functions, no external dependencies)
	toolPromises.push(
		runToolWithTiming("builtin", async () => {
			const findings: Finding[] = [];
			let checked = 0;
			for (const file of files) {
				try {
					const text = await Bun.file(absolute(cwd, file)).text();
					checked++;
					findings.push(...runBuiltinChecks(file, text));
				} catch {
					// File read failure should not block pipeline
				}
			}
			// Nothing readable (e.g. every file in scope is gone) → it did not run.
			return { findings, skipped: checked === 0 };
		}),
	);

	// Wiki lint — only runs if .maina/wiki/ exists (auto-skips otherwise)
	toolPromises.push(
		runToolWithTiming("wiki-lint", () =>
			runWikiLintTool({ cwd, mainaDir, process: processPort }),
		),
	);

	// Affected tests — only on request: the graph's covering tests for the
	// change and its callers, plus changed test files (FR-VER-5).
	if (options.tests) {
		toolPromises.push(
			runToolWithTiming(AFFECTED_TESTS_TOOL, () =>
				runAffectedTests(selectAffectedTests(files, radius), cwd, {
					process: processPort,
					...(options.env ? { env: options.env } : {}),
				}),
			),
		);
	}

	const toolReports = await Promise.all(toolPromises);

	// ── Step 4b: Warn if all external tools were skipped ─────────────────
	const builtInTools = new Set([
		"slop",
		"typecheck",
		"consistency",
		"builtin",
		"wiki-lint",
		"doc-claims",
		AFFECTED_TESTS_TOOL,
	]);
	const externalTools = toolReports.filter((r) => !builtInTools.has(r.tool));
	const allExternalSkipped =
		externalTools.length > 0 && externalTools.every((r) => r.skipped);

	// ── Step 5: Collect all findings ──────────────────────────────────────
	const allFindings: Finding[] = [];
	for (const report of toolReports) {
		allFindings.push(...report.findings);
	}

	if (allExternalSkipped) {
		const skippedNames = externalTools.map((r) => r.tool).join(", ");
		allFindings.push({
			tool: "pipeline",
			file: "",
			line: 0,
			message: `WARNING: No external verification tools detected (${skippedNames} skipped). Built-in checks (typecheck, consistency, slop) still ran. Run \`maina init --install\` to add external tools.`,
			severity: "warning",
		});
	}

	// ── Step 6: Apply diff-only filter ────────────────────────────────────
	let shownFindings: Finding[];
	let hiddenCount: number;

	if (diffOnly) {
		const filtered = await filterByDiff(allFindings, baseBranch, cwd, {
			includeUntracked: scopeKind === "working-tree",
			...(radius ? { blastRadius: radius } : {}),
		});
		shownFindings = filtered.shown;
		hiddenCount = filtered.hidden;
	} else {
		shownFindings = allFindings;
		hiddenCount = 0;
	}

	// ── Step 6b: Findings triage through decide (#329) ──────────────────
	// finding.real at the policy's threshold suppresses noise; finding.severity
	// sets the rest. Probabilities, not dismiss ratios, drive both.
	const decidePorts = options.decide ?? defaultDecidePorts;
	const preferences = loadPreferences(mainaDir);
	const triaged = triageFindings(decidePorts, shownFindings, preferences);
	shownFindings = [...triaged.kept];

	// ── Step 7: AI review (deep only on --deep or when triage asks) ──────
	let diffText = "";
	try {
		diffText = diffOnly ? await getDiff(baseBranch, undefined, cwd) : "";
	} catch {
		// getDiff failure should not block pipeline
	}

	const triageResult = triageDiff(decidePorts, diffText);
	const triage = triageResult.ok ? triageResult.value : undefined;
	const deep = runsDeepReview(options.deep ?? false, triage);

	const aiReviewResult: AIReviewResult = await runAIReview({
		diff: diffText,
		entities: await reviewEntities(options.graph, mainaDir, cwd, diffText),
		deep,
		mainaDir,
		root: cwd,
		env: envFromRecord(options.env ?? {}),
	});

	const aiTriaged = triageFindings(
		decidePorts,
		aiReviewResult.findings,
		preferences,
	);
	const aiReport: ToolReport = {
		tool: "ai-review",
		findings: [...aiTriaged.kept],
		skipped: aiReviewResult.skipped,
		duration: aiReviewResult.duration,
	};

	// Reports carry the triaged findings too: the receipt is built from them.
	const reports = [
		...toolReports.map((r) => withTriaged(r, triaged.byOriginal)),
		aiReport,
	];

	// Merge AI findings into shown findings
	shownFindings.push(...aiTriaged.kept);

	// ── Step 8: Determine status ──────────────────────────────────────────
	const status = deriveStatus(shownFindings, reports);

	// ── Step 9: Return unified result ─────────────────────────────────────
	const cacheStats = slopCache.stats();
	return {
		status,
		passed: status === "passed",
		scope,
		syntaxPassed: true,
		tools: reports,
		findings: shownFindings,
		hiddenCount,
		detectedTools,
		duration: Math.round(performance.now() - start),
		cacheHits: cacheStats.l1Hits + cacheStats.l2Hits,
		cacheMisses: cacheStats.misses,
		...(triage ? { triage } : {}),
		...(radius ? { blastRadius: radius } : {}),
	};
}
