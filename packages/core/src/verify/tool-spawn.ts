/**
 * Shared spawn path for the external verify runners (#389).
 *
 * Detection may resolve a tool to `<root>/node_modules/.bin/<tool>` when it is
 * not on the global PATH. Runners must spawn that resolved path, not the bare
 * command name, and a tool that cannot be started must be reported as
 * skipped with a notice: an ENOENT is never a pass with zero findings.
 */

import type { Result } from "../db/index";
import type { ProcessPort } from "../ports/process";
import { systemProcess } from "../process/index";
import { detectTool, TOOL_REGISTRY, type ToolName } from "./detect";

/** How a runner is told about its tool: pre-resolved by the pipeline, or not. */
interface ToolResolutionOptions {
	/** Repository root detection resolves local binaries from. */
	readonly cwd: string;
	/** Pre-resolved availability; when omitted the runner detects the tool. */
	readonly available?: boolean;
	/** Pre-resolved command path from detection (e.g. root-local node_modules/.bin). */
	readonly command?: string;
	/** Runs the detection probe when availability is not pre-resolved. */
	readonly process?: ProcessPort;
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
	const detected = await detectTool(name, options.cwd, options.process);
	return {
		available: detected.available,
		command: options.command ?? detected.command,
	};
}

interface ToolOutput {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
	/** Epoch ms just before the process was spawned. */
	readonly startedAt: number;
}

type ToolSpawnError = {
	readonly kind: "spawn-failed";
	readonly command: string;
	readonly message: string;
};

/**
 * Spawn a tool through a `ProcessPort` (the system adapter by default) and
 * collect its output. A failure to start the process (ENOENT, EACCES, a
 * timeout) comes back as a typed error instead of a throw.
 */
export async function spawnTool(
	argv: readonly [string, ...string[]],
	cwd: string,
	processPort: ProcessPort = systemProcess,
): Promise<Result<ToolOutput, ToolSpawnError>> {
	const startedAt = Date.now();
	const result = await processPort.spawn(argv, { cwd });
	if (!result.ok) {
		return {
			ok: false,
			error: {
				kind: "spawn-failed",
				command: argv[0],
				message:
					result.error.kind === "timeout"
						? `timed out after ${result.error.timeoutMs}ms`
						: result.error.message,
			},
		};
	}
	return { ok: true, value: { ...result.value, startedAt } };
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
 * with zero findings. Callers decide what "no results" means: no JSON on
 * stdout for stdout-reporting tools, no fresh report file for the others. A
 * non-zero exit that did produce results is kept: several tools exit
 * non-zero precisely because they found issues.
 */
export function exitFailureNotice(tool: string, output: ToolOutput): string {
	const detail = output.stderr.trim().slice(0, 300);
	return `${tool} exited with code ${output.exitCode} without results${detail ? `: ${detail}` : ""}. Skipped, no results from this tool.`;
}

/**
 * True when a run exited non-zero and its stdout is not a JSON report
 * (empty, or an error message): there is nothing trustworthy to parse.
 */
export function failedWithoutResults(output: ToolOutput): boolean {
	return output.exitCode !== 0 && !isJson(output.stdout);
}

function isJson(text: string): boolean {
	if (text.trim() === "") return false;
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
}

/** Slack for filesystems that store mtimes at whole-second precision. */
const MTIME_SLACK_MS = 2000;

/**
 * True when a report file was written by this run rather than left over
 * from an earlier one, judged by its mtime against the spawn time.
 */
export function isFreshReport(
	lastModified: number,
	output: ToolOutput,
): boolean {
	return lastModified >= output.startedAt - MTIME_SLACK_MS;
}
