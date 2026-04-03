import { existsSync } from "node:fs";
import { join } from "node:path";

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
): Promise<HookResult> {
	try {
		if (!existsSync(hookPath)) {
			return {
				status: "warn",
				message: `Hook not found: ${hookPath}`,
			};
		}

		const jsonInput = JSON.stringify(context);

		const proc = Bun.spawn(["sh", hookPath], {
			stdin: new Blob([jsonInput]),
			stdout: "pipe",
			stderr: "pipe",
			cwd: context.repoRoot,
		});

		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		if (exitCode === 0) {
			return { status: "continue" };
		}

		const message = stderr.trim() || `Hook exited with code ${exitCode}`;

		if (exitCode === 2) {
			return { status: "block", message };
		}

		return { status: "warn", message };
	} catch (e) {
		return {
			status: "warn",
			message: e instanceof Error ? e.message : String(e),
		};
	}
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
): Promise<HookResult> {
	const hooks = await scanHooks(mainaDir, event);

	if (hooks.length === 0) {
		return { status: "continue" };
	}

	const warnings: string[] = [];

	for (const hookPath of hooks) {
		const result = await executeHook(hookPath, context);

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
