import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import { assembleContext } from "@mainahq/core";
import { Command } from "commander";
import { outputJson } from "../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContextActionOptions {
	/** Override the repo root. Defaults to `process.cwd()`. */
	cwd?: string;
	/** Limit to a specific directory inside the repo. */
	scope?: string;
	/** Only print the layer report — do not write any output file. */
	show?: boolean;
	/** Override the budget mode. `"explore"` is the CLI default. */
	mode?: string;
	/** Emit JSON to stdout. Suppresses all UI. */
	json?: boolean;
	/** Explicit output path. Overrides the `.maina/CONTEXT.md` default. */
	output?: string;
	/**
	 * When true, still write to the legacy `<repoRoot>/CONTEXT.md` if one
	 * already exists. The default is to leave the legacy file untouched
	 * and write to `.maina/CONTEXT.md`.
	 */
	force?: boolean;
}

export interface ContextActionResult {
	mode: string;
	tokens: number;
	budget: { total: number };
	layers: {
		name: string;
		tokens: number;
		entries: number;
		included: boolean;
	}[];
	/** Absolute path the context was written to, or `null` when `--show`. */
	written: string | null;
	/** True when the legacy `<repoRoot>/CONTEXT.md` was preserved. */
	legacyPreserved: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatLayerTable(
	layers: {
		name: string;
		tokens: number;
		entries: number;
		included: boolean;
	}[],
): string {
	const header = `  ${"Layer".padEnd(12)} ${"Tokens".padStart(6)}  ${"Entries".padStart(7)}  Status`;
	const separator = `  ${"─".repeat(12)} ${"─".repeat(6)}  ${"─".repeat(7)}  ${"─".repeat(8)}`;
	const rows = layers.map((l) => {
		const status = l.included ? "included" : "excluded";
		return `  ${l.name.padEnd(12)} ${String(l.tokens).padStart(6)}  ${String(l.entries).padStart(7)}  ${status}`;
	});
	return [header, separator, ...rows].join("\n");
}

function formatSummary(result: {
	tokens: number;
	mode: string;
	budget: { total: number };
}): string {
	const usage =
		result.budget.total > 0
			? `${((result.tokens / result.budget.total) * 100).toFixed(1)}%`
			: "N/A";
	return `Mode: ${result.mode} | Tokens: ${result.tokens} / ${result.budget.total} (${usage})`;
}

/**
 * Resolve the effective output path for `maina context` according to the
 * rules in §6.8 of the onboarding-60s spec:
 *
 *   1. Explicit `--output <path>` wins, verbatim (resolved against cwd
 *      if relative).
 *   2. Otherwise, the legacy `<repoRoot>/CONTEXT.md` is preserved when
 *      it already exists and `--force` was not passed — we write to
 *      `.maina/CONTEXT.md` instead.
 *   3. With `--force`, and only with `--force`, a pre-existing
 *      `<repoRoot>/CONTEXT.md` is overwritten in place.
 *   4. Default when no legacy file and no `--output` is
 *      `<repoRoot>/.maina/CONTEXT.md`.
 */
export function resolveContextOutputPath(
	repoRoot: string,
	options: Pick<ContextActionOptions, "output" | "force">,
): { path: string; legacyPreserved: boolean } {
	if (options.output !== undefined && options.output !== "") {
		const resolved = isAbsolute(options.output)
			? options.output
			: resolve(repoRoot, options.output);
		return { path: resolved, legacyPreserved: false };
	}

	const legacy = join(repoRoot, "CONTEXT.md");
	if (existsSync(legacy) && options.force === true) {
		return { path: legacy, legacyPreserved: false };
	}

	const mainaPath = join(repoRoot, ".maina", "CONTEXT.md");
	const legacyPreserved = existsSync(legacy);
	return { path: mainaPath, legacyPreserved };
}

// ── Core Action (testable) ──────────────────────────────────────────────────

/**
 * Core `maina context` action. Decoupled from Commander so unit tests can
 * drive it directly without constructing a full program. The commander
 * wrapper (below) just parses flags and forwards.
 */
export async function contextAction(
	options: ContextActionOptions = {},
): Promise<ContextActionResult> {
	const repoRoot = options.cwd ?? process.cwd();
	const mainaDir = join(repoRoot, ".maina");
	const validModes = new Set(["focused", "default", "explore"]);
	const modeOverride: "focused" | "default" | "explore" | undefined =
		options.mode && options.mode !== "explore" && validModes.has(options.mode)
			? (options.mode as "focused" | "default" | "explore")
			: undefined;

	const assembleOptions: Parameters<typeof assembleContext>[1] = {
		repoRoot,
		mainaDir,
	};
	if (options.scope !== undefined) {
		assembleOptions.scope = options.scope;
	}
	if (modeOverride !== undefined) {
		assembleOptions.modeOverride = modeOverride;
	}
	const result = await assembleContext("context", assembleOptions);

	let written: string | null = null;
	let legacyPreserved = false;
	if (options.show !== true) {
		const resolved = resolveContextOutputPath(repoRoot, options);
		legacyPreserved = resolved.legacyPreserved;
		mkdirSync(dirname(resolved.path), { recursive: true });
		await Bun.write(resolved.path, result.text);
		written = resolved.path;
	}

	return {
		mode: result.mode,
		tokens: result.tokens,
		budget: result.budget,
		layers: result.layers,
		written,
		legacyPreserved,
	};
}

// ── Command factory ───────────────────────────────────────────────────────────

export function contextCommand(): Command {
	const cmd = new Command("context")
		.description("Generate focused codebase context")
		.option("--scope <dir>", "Limit to specific directory")
		.option("--show", "Show layer report only")
		.option("--mode <mode>", "Budget mode: explore|focused|default", "explore")
		.option(
			"--output <path>",
			"Write context to this path (overrides the .maina/CONTEXT.md default)",
		)
		.option(
			"--force",
			"Overwrite legacy <repoRoot>/CONTEXT.md in place when it already exists",
		)
		.option("--json", "Output JSON")
		.action(async (options) => {
			if (!options.json) intro("maina context");

			const s = options.json ? null : spinner();
			s?.start("Assembling context…");

			const actionOpts: ContextActionOptions = {};
			if (options.scope !== undefined) actionOpts.scope = options.scope;
			if (options.show === true) actionOpts.show = true;
			if (options.mode !== undefined) actionOpts.mode = options.mode;
			if (options.output !== undefined) actionOpts.output = options.output;
			if (options.force === true) actionOpts.force = true;
			if (options.json === true) actionOpts.json = true;

			const result = await contextAction(actionOpts);

			s?.stop("Context assembled.");

			if (options.json) {
				outputJson({
					mode: result.mode,
					tokens: result.tokens,
					budget: result.budget,
					layers: result.layers,
					written: result.written,
					legacyPreserved: result.legacyPreserved,
				});
				return;
			}

			log.info(formatSummary(result));
			log.message(formatLayerTable(result.layers));

			if (result.written !== null) {
				log.success(`Written to ${result.written}`);
				if (result.legacyPreserved) {
					log.info(
						"A legacy CONTEXT.md at the repo root was left untouched. " +
							"Pass `--force` to overwrite it in place, or delete it " +
							"once you have migrated tooling to .maina/CONTEXT.md.",
					);
				}
			}

			outro("Done.");
		});

	// Subcommand: context add <file>
	cmd
		.command("add <file>")
		.description("Add file to semantic custom context")
		.action(async (file: string) => {
			intro("maina context add");

			const repoRoot = process.cwd();
			const mainaDir = join(repoRoot, ".maina");
			const destDir = join(mainaDir, "context", "semantic", "custom");

			try {
				mkdirSync(destDir, { recursive: true });

				const srcFile = Bun.file(file);
				if (!(await srcFile.exists())) {
					log.error(`File not found: ${file}`);
					outro("Aborted.");
					return;
				}

				const content = await srcFile.text();
				const destPath = join(destDir, basename(file));
				await Bun.write(destPath, content);
				log.success(`Added ${basename(file)} to custom context.`);
				outro("Done.");
			} catch {
				outro("Aborted.");
			}
		});

	// Subcommand: context show
	cmd
		.command("show")
		.description("Show context layers with token counts")
		.action(async () => {
			intro("maina context show");

			const repoRoot = process.cwd();
			const mainaDir = join(repoRoot, ".maina");

			const s = spinner();
			s.start("Loading context layers…");

			const result = await assembleContext("context", {
				repoRoot,
				mainaDir,
			});

			s.stop("Layers loaded.");

			log.info(formatSummary(result));
			log.message(formatLayerTable(result.layers));

			outro("Done.");
		});

	return cmd;
}
