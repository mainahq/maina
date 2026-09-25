/**
 * Standalone runtime entry (v1 task 2.3, FR-INS-1; ADR 0045).
 *
 * `build/standalone.ts` compiles this file into the self-contained `maina`
 * executable that `launcher/launch.sh` and `launcher/launch.ps1` run:
 *
 *   maina mcp                 the MCP server over stdio
 *   maina hook <event>        one host hook (native event name, JSON on stdin)
 *   maina cli [args...]       the maina CLI
 *   maina runtime-daemon ...  the resident runtime (spawned by clients)
 *
 * Each mode loads only what it needs, so a cold MCP start does not pay for
 * the CLI and a hook does not pay for the MCP server.
 */

// Cursor's events (camelCase) come from its adapter, which is pure and cheap.
import { CURSOR_HOOK_EVENTS } from "../adapters/cursor";
import { failClosedHookOutput } from "./hook-fallback";

/**
 * Claude Code's hook events (PascalCase), answered by the Claude Code
 * adapter. Codex uses the same names but not the same answers: it runs a
 * tool whose PreToolUse hook asks. Codex hooks must go through
 * `adapters/codex.ts` instead (mainahq/maina#475).
 */
const CLAUDE_EVENTS: ReadonlySet<string> = new Set([
	"PreToolUse",
	"PermissionRequest",
	"PostToolUse",
	"SessionStart",
	"Stop",
]);

const [mode, ...rest] = process.argv.slice(2);

switch (mode) {
	case "mcp": {
		const { startServer } = await import("@mainahq/mcp");
		await startServer();
		break;
	}
	case "hook": {
		const event = rest[0] ?? "";
		if (!CLAUDE_EVENTS.has(event) && !CURSOR_HOOK_EVENTS.has(event)) {
			// No adapter answers this event: the fail-closed answer, never an allow.
			process.stdout.write(
				`${failClosedHookOutput(event, "gate_not_active")}\n`,
			);
			break;
		}
		try {
			const { runClaudeHookProcess, runCursorHookProcess } = await import(
				"../hook-system"
			);
			process.exitCode = CLAUDE_EVENTS.has(event)
				? await runClaudeHookProcess(event)
				: await runCursorHookProcess(event);
		} catch {
			process.stdout.write(`${failClosedHookOutput(event, "hook_crashed")}\n`);
		}
		break;
	}
	case "cli": {
		// The CLI reads its arguments from process.argv after the script path.
		process.argv.splice(2, 1);
		await import("@mainahq/cli/src/index.ts");
		break;
	}
	case "runtime-daemon": {
		const { runDaemon } = await import("../daemon-main");
		process.exit(await runDaemon(rest));
		break;
	}
	default:
		process.stderr.write(
			"usage: maina mcp | hook <event> | cli [args...] | runtime-daemon ...\n",
		);
		process.exit(64);
}
