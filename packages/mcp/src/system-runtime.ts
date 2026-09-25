/**
 * The real runtime behind the MCP tools: each capability calls core with
 * the explicit root it is given, the system filesystem, git and processes.
 * Capabilities never throw; a core failure comes back as a `RuntimeError`.
 *
 * Only `resolveRoot` looks at `cwd`, and only when a call names no root.
 * The standalone runtime replaces it with its own resolution (host project
 * dir, MCP roots, git root; FR-INS-3).
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
	analyze,
	codeGraphImpact,
	codeGraphMinimalContext,
	DEFAULT_REGISTRY,
	type DecideError,
	decide,
	type EnvPort,
	type GraphStoreError,
	type GraphStorePorts,
	getRepoRoot,
	hasFullCodeGraphIndex,
	indexRepo,
	loadPolicy,
	openCodeGraph,
	type PolicyError,
	queryWiki,
	type Result,
	readUserPolicy,
	runPipeline,
	runTwoStageReview,
	systemFs,
	systemProcess,
	updateFiles,
	verifyReceipt,
} from "@mainahq/core";
import type {
	McpRuntime,
	ReceiptCheck,
	RootResolver,
	RuntimeError,
	SpecReport,
	WikiArticleRef,
} from "./runtime";

export type SystemRuntimeOptions = Readonly<{
	/** Where a call without an explicit root looks for the repository. */
	cwd: string;
	/** Environment for AI key/host detection and child processes. */
	env: Readonly<Record<string, string | undefined>>;
	/** The user's home, for the user policy layer. Omitted: no user layer. */
	home?: string;
	resolveRoot?: RootResolver;
}>;

const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

const failed = (message: string): Result<never, RuntimeError> => ({
	ok: false,
	error: { kind: "failed", message },
});

const errorText = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

/** Runs `work`, turning a throw from a legacy core path into `failed`. */
async function guard<T>(
	work: () => Promise<Result<T, RuntimeError>>,
): Promise<Result<T, RuntimeError>> {
	try {
		return await work();
	} catch (e) {
		return failed(errorText(e));
	}
}

const isDirectory = (path: string): boolean => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};

/** Explicit roots must be absolute directories; else the git root of `cwd`. */
function defaultRootResolver(cwd: string): RootResolver {
	return async (explicit) => {
		if (explicit !== undefined && explicit.trim() !== "") {
			if (!isAbsolute(explicit)) {
				return {
					ok: false,
					error: {
						kind: "no_root",
						message: `root must be an absolute path, got ${explicit}`,
					},
				};
			}
			const root = resolve(explicit);
			return isDirectory(root)
				? ok(root)
				: {
						ok: false,
						error: {
							kind: "no_root",
							message: `${explicit} is not a directory`,
						},
					};
		}
		const top = isDirectory(cwd) ? await getRepoRoot(cwd) : "";
		return top
			? ok(top)
			: {
					ok: false,
					error: {
						kind: "no_root",
						message: `no git repository at ${cwd}; pass an explicit root`,
					},
				};
	};
}

const describePolicyError = (e: PolicyError): string =>
	`${e.file ?? e.source}${e.path ? ` ${e.path}` : ""}: ${e.message}`;

function describeDecideError(e: DecideError): string {
	switch (e.kind) {
		case "unknown_type":
			return `unknown decision type ${e.type}`;
		case "no_backend":
			return `no ${e.backend} backend for ${e.type}`;
		case "invalid_question":
		case "unsupported":
		case "backend_failed":
		case "invalid_answer":
			return e.message;
		default: {
			const unreachable: never = e;
			return String(unreachable);
		}
	}
}

function describeGraphError(e: GraphStoreError): string {
	switch (e.kind) {
		case "db":
			return `code graph: ${e.message}`;
		case "fs":
			return `code graph: ${e.path}: ${e.message}`;
		case "parse":
			return "code graph: a file could not be parsed";
		case "conflict":
			return `code graph: another writer won ${e.attempts} times; retry`;
		default: {
			const unreachable: never = e;
			return String(unreachable);
		}
	}
}

/**
 * Opens the code graph under `root`, brings it current for `touched`
 * (indexing the repo once when it never was), runs `query`, closes it.
 */
async function withGraph<T>(
	root: string,
	touched: readonly string[],
	query: (ports: GraphStorePorts) => Promise<Result<T, GraphStoreError>>,
): Promise<Result<T, RuntimeError>> {
	const opened = openCodeGraph(join(root, ".maina"));
	if (!opened.ok) return failed(`code graph: ${opened.error.message}`);
	const { ports, close } = opened.value;
	try {
		const indexed = hasFullCodeGraphIndex(ports.db);
		if (!indexed.ok) return failed(describeGraphError(indexed.error));
		const synced = indexed.value
			? await updateFiles(ports, root, touched)
			: await indexRepo(ports, root);
		if (!synced.ok) return failed(describeGraphError(synced.error));
		const result = await query(ports);
		return result.ok ? result : failed(describeGraphError(result.error));
	} finally {
		close();
	}
}

async function readJson(path: string): Promise<Result<unknown, string>> {
	try {
		return ok(JSON.parse(await readFile(path, "utf-8")));
	} catch (e) {
		return { ok: false, error: errorText(e) };
	}
}

const WIKI_CATEGORIES = [
	"modules",
	"entities",
	"features",
	"decisions",
	"architecture",
] as const;

function wikiArticles(wikiDir: string): WikiArticleRef[] {
	return WIKI_CATEGORIES.flatMap((category) => {
		const dir = join(wikiDir, category);
		if (!isDirectory(dir)) return [];
		try {
			return readdirSync(dir)
				.filter((f) => f.endsWith(".md"))
				.sort()
				.map((file) => ({
					path: `${category}/${file}`,
					type: category.replace(/s$/, ""),
					title: file.replace(/\.md$/, "").replace(/-/g, " "),
				}));
		} catch {
			return [];
		}
	});
}

export function systemRuntime(options: SystemRuntimeOptions): McpRuntime {
	const envPort: EnvPort = { get: (name) => options.env[name] };
	const mainaDir = (root: string) => join(root, ".maina");

	const policyFor = async (root: string) => {
		const user =
			options.home === undefined
				? ok(undefined)
				: await readUserPolicy({ fs: systemFs }, options.home);
		if (!user.ok) return user;
		return loadPolicy({ fs: systemFs }, root, user.value);
	};

	return {
		resolveRoot: options.resolveRoot ?? defaultRootResolver(options.cwd),

		verify: ({ root, files, base }) =>
			guard(async () =>
				ok(
					await runPipeline({
						...(files !== undefined ? { files: [...files] } : {}),
						...(base !== undefined ? { baseBranch: base } : {}),
						cwd: root,
						mainaDir: mainaDir(root),
						env: options.env,
						process: systemProcess,
					}),
				),
			),

		decide: ({ root, request }) =>
			guard(async () => {
				const policy = await policyFor(root);
				if (!policy.ok) {
					return failed(
						`policy is invalid: ${policy.error.map(describePolicyError).join("; ")}`,
					);
				}
				const result = decide(
					{
						clock: { now: () => performance.now() },
						policy: policy.value,
						backends: DEFAULT_REGISTRY,
					},
					request,
				);
				return result.ok
					? result
					: {
							ok: false,
							error: {
								kind: "invalid_input",
								message: describeDecideError(result.error),
							},
						};
			}),

		impact: ({ root, files, symbols, depth }) =>
			guard(() =>
				withGraph(root, files ?? [], async (ports) =>
					codeGraphImpact(ports, {
						...(files !== undefined ? { files } : {}),
						...(symbols !== undefined ? { symbols } : {}),
						...(depth !== undefined ? { depth } : {}),
					}),
				),
			),

		context: ({ root, files, query, budgetTokens, depth }) =>
			guard(() =>
				withGraph(root, files ?? [], (ports) =>
					codeGraphMinimalContext(ports, root, {
						...(files !== undefined ? { files } : {}),
						...(query !== undefined ? { query } : {}),
						budgetTokens,
						...(depth !== undefined ? { depth } : {}),
					}),
				),
			),

		review: ({ root, diff, files, base, planContent }) =>
			guard(async () => {
				let text = diff;
				if (text === undefined) {
					const out = await systemProcess.spawn(
						// `--end-of-options`: a base is never read as an option.
						[
							"git",
							"diff",
							"--end-of-options",
							base ?? "HEAD",
							"--",
							...(files ?? []),
						],
						{ cwd: root },
					);
					if (!out.ok) return failed(`git diff: ${out.error.kind}`);
					if (out.value.exitCode !== 0) {
						return failed(`git diff: ${out.value.stderr.trim()}`);
					}
					text = out.value.stdout;
				}
				const result = await runTwoStageReview({
					diff: text,
					...(planContent !== undefined ? { planContent } : {}),
					mainaDir: mainaDir(root),
					ai: { root, env: envPort },
				});
				const delegated = [
					...result.stage1.findings,
					...(result.stage2?.findings ?? []),
				].some((f) => f.message.startsWith("AI review delegated to host"));
				return ok({ result, delegated });
			}),

		specCheck: ({ root, paths }) =>
			guard(async () => {
				const reports: SpecReport[] = [];
				for (const path of paths) {
					const report = analyze(join(root, path));
					if (!report.ok) {
						return {
							ok: false,
							error: { kind: "not_found", path, message: report.error },
						};
					}
					reports.push({ path, report: report.value });
				}
				return ok(reports);
			}),

		receipts: ({ root, paths }) =>
			guard(async () => {
				const checks: ReceiptCheck[] = [];
				for (const path of paths) {
					const raw = await readJson(join(root, path));
					checks.push({
						path,
						result: raw.ok
							? verifyReceipt(raw.value)
							: {
									ok: false,
									code: "io",
									message: `could not read ${path}: ${raw.error}`,
								},
					});
				}
				return ok(checks);
			}),

		status: ({ root }) =>
			guard(async () => {
				let graphIndexed = false;
				if (existsSync(join(mainaDir(root), "graph", "index.db"))) {
					const opened = openCodeGraph(mainaDir(root));
					if (opened.ok) {
						const indexed = hasFullCodeGraphIndex(opened.value.ports.db);
						graphIndexed = indexed.ok && indexed.value;
						opened.value.close();
					}
				}
				const policy = await policyFor(root);
				return ok({
					graphIndexed,
					wikiInitialized: isDirectory(join(mainaDir(root), "wiki")),
					policyErrors: policy.ok ? [] : policy.error.map(describePolicyError),
				});
			}),

		wiki: {
			ask: ({ root, question }) =>
				guard(async () => {
					const result = await queryWiki({
						question,
						wikiDir: join(mainaDir(root), "wiki"),
						repoRoot: root,
						env: envPort,
					});
					return result.ok
						? ok({ answer: result.value.answer, sources: result.value.sources })
						: failed(result.error);
				}),
			structure: ({ root }) =>
				guard(async () => ok(wikiArticles(join(mainaDir(root), "wiki")))),
			contents: ({ root, page }) =>
				guard(async () => {
					const path = join(mainaDir(root), "wiki", page);
					const read = await systemFs.readFile(path);
					if (read.ok) return read;
					return read.error.kind === "not_found"
						? {
								ok: false,
								error: {
									kind: "not_found",
									path: page,
									message: `wiki article not found: ${page}`,
								},
							}
						: failed(read.error.message);
				}),
		},
	};
}
