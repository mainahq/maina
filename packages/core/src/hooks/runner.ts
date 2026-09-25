import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProcessPort } from "../ports/process";
import { systemProcess } from "../process/index";

export type HookEvent =
	| "pre-commit"
	| "post-commit"
	| "pre-verify"
	| "post-verify"
	| "pre-review"
	| "post-learn";

export interface HookContext {
	event: HookEvent;
	repoRoot: string;
	mainaDir: string;
	stagedFiles?: string[];
	branch?: string;
	timestamp: string;
}

export type HookResult =
	| { status: "continue" }
	| { status: "block"; message: string }
	| { status: "warn"; message: string };

/**
 * Scan the hooks directory for scripts matching the given event.
 * Looks for `.maina/hooks/<event>.sh`.
 */
export async function scanHooks(
	mainaDir: string,
	event: HookEvent,
): Promise<string[]> {
	const hooksDir = join(mainaDir, "hooks");
	const scriptPath = join(hooksDir, `${event}.sh`);
	if (existsSync(scriptPath)) {
		return [scriptPath];
	}
	return [];
}

/**
 * Execute a single hook script, piping the JSON context on stdin.
 *
 * Exit code semantics:
 *   0 = continue
 *   2 = block (stderr captured as message)
 *   other = warn and continue (stderr captured as message)
 */
export async function executeHook(
	hookPath: string,
	context: HookContext,
	processPort: ProcessPort = systemProcess,
): Promise<HookResult> {
	if (!existsSync(hookPath)) {
		return {
			status: "warn",
			message: `Hook not found: ${hookPath}`,
		};
	}

	const result = await processPort.spawn(["sh", hookPath], {
		cwd: context.repoRoot,
		stdin: JSON.stringify(context),
	});
	if (!result.ok) {
		return {
			status: "warn",
			message:
				result.error.kind === "timeout"
					? `Hook timed out after ${result.error.timeoutMs}ms: ${hookPath}`
					: result.error.message,
		};
	}

	const { exitCode, stderr } = result.value;
	if (exitCode === 0) {
		return { status: "continue" };
	}

	const message = stderr.trim() || `Hook exited with code ${exitCode}`;

	if (exitCode === 2) {
		return { status: "block", message };
	}

	return { status: "warn", message };
}

/**
 * Scan for all hooks matching the event and execute them in sequence.
 *
 * - If any hook returns "block", stop immediately and return block.
 * - If any hook returns "warn", continue but collect warnings.
 * - If all return "continue", return continue.
 */
export async function runHooks(
	mainaDir: string,
	event: HookEvent,
	context: HookContext,
	processPort: ProcessPort = systemProcess,
): Promise<HookResult> {
	const hooks = await scanHooks(mainaDir, event);

	if (hooks.length === 0) {
		return { status: "continue" };
	}

	const warnings: string[] = [];

	for (const hookPath of hooks) {
		const result = await executeHook(hookPath, context, processPort);

		if (result.status === "block") {
			return result;
		}

		if (result.status === "warn") {
			warnings.push(result.message);
		}
	}

	if (warnings.length > 0) {
		return { status: "warn", message: warnings.join("\n") };
	}

	return { status: "continue" };
}
