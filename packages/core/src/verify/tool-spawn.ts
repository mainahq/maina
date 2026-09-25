/**
 * Shared spawn path for the external verify runners (#389).
 *
 * Detection may resolve a tool to `<root>/node_modules/.bin/<tool>` when it is
 * not on the global PATH. Runners must spawn that resolved path, not the bare
 * command name, and a tool that cannot be started must be reported as
 * skipped with a notice: an ENOENT is never a pass with zero findings.
 */

import type { Result } from "../db/index";
import { detectTool, TOOL_REGISTRY, type ToolName } from "./detect";

/** How a runner is told about its tool: pre-resolved by the pipeline, or not. */
interface ToolResolutionOptions {
	/** Repository root detection resolves local binaries from. */
	readonly cwd: string;
	/** Pre-resolved availability; when omitted the runner detects the tool. */
	readonly available?: boolean;
	/** Pre-resolved command path from detection (e.g. root-local node_modules/.bin). */
	readonly command?: string;
}

interface ResolvedTool {
	readonly available: boolean;
	readonly command: string;
}

/**
 * Resolve whether a tool is available and which command to spawn for it.
 * Pre-resolved values from the pipeline win; otherwise detection decides.
 */
export async function resolveTool(
	name: ToolName,
	options: ToolResolutionOptions,
): Promise<ResolvedTool> {
	if (options.available !== undefined) {
		return {
			available: options.available,
			command: options.command ?? TOOL_REGISTRY[name].command,
		};
	}
	const detected = await detectTool(name, options.cwd);
	return {
		available: detected.available,
		command: options.command ?? detected.command,
	};
}

interface ToolOutput {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

type ToolSpawnError = {
	readonly kind: "spawn-failed";
	readonly command: string;
	readonly message: string;
};

/**
 * Spawn a tool and collect its output. A failure to start the process
 * (ENOENT, EACCES, …) comes back as a typed error instead of a throw.
 */
export async function spawnTool(
	argv: readonly [string, ...string[]],
	cwd: string,
): Promise<Result<ToolOutput, ToolSpawnError>> {
	try {
		const proc = Bun.spawn([...argv], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;
		return { ok: true, value: { stdout, stderr, exitCode } };
	} catch (e) {
		return {
			ok: false,
			error: {
				kind: "spawn-failed",
				command: argv[0],
				message: e instanceof Error ? e.message : String(e),
			},
		};
	}
}

/** Human-readable notice for a tool that was detected but could not start. */
export function spawnFailureNotice(
	tool: string,
	error: ToolSpawnError,
): string {
	return `${tool} was detected but could not be started (${error.command}): ${error.message}. Skipped, no results from this tool.`;
}

/**
 * Notice for a tool that started but exited non-zero and left no results
 * (e.g. a rules fetch or config error). Such a run is a skip, not a pass
 * with zero findings. Callers decide what "no results" means: empty stdout
 * for stdout-reporting tools, a missing report file for the others. A
 * non-zero exit that did produce results is kept: several tools exit
 * non-zero precisely because they found issues.
 */
export function exitFailureNotice(tool: string, output: ToolOutput): string {
	const detail = output.stderr.trim().slice(0, 300);
	return `${tool} exited with code ${output.exitCode} without results${detail ? `: ${detail}` : ""}. Skipped, no results from this tool.`;
}

/** True when a run exited non-zero and wrote nothing to stdout. */
export function failedWithoutOutput(output: ToolOutput): boolean {
	return output.exitCode !== 0 && output.stdout.trim() === "";
}
