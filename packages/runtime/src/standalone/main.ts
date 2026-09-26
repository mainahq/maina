/**
 * Standalone runtime entry (v1 task 2.3, FR-INS-1; ADR 0045).
 *
 * `build/standalone.ts` compiles this file into the self-contained `maina`
 * executable that `launcher/launch.sh` and `launcher/launch.ps1` run:
 *
 *   maina mcp                 the MCP server over stdio
 *   maina hook [--host <claude|codex|cursor>] <event>
 *                             one host hook (native event name, JSON on
 *                             stdin), answered by that host's adapter
 *                             (`hook-route.ts`)
 *   maina cli [args...]       the maina CLI
 *   maina statusline [install|remove|preview ...]
 *                             the agent status line (`cli statusline ...`
 *                             too, so the launcher's `cli` mode reaches it)
 *   maina runtime-daemon ...  the resident runtime (spawned by clients)
 *
 * Each mode loads only what it needs, so a cold MCP start does not pay for
 * the CLI and a hook does not pay for the MCP server.
 */

import { homedir } from "node:os";
import { failClosedHook, type HookHost } from "./hook-fallback";
// The routing reads the adapters' event lists, which are pure and cheap.
import { routeHook } from "./hook-route";

/** Prints the fail-closed answer for `event` and sets the exit code. */
function failClosed(host: HookHost | undefined, event: string, cause: string) {
	const out = failClosedHook(host, event, cause);
	process.stdout.write(`${out.line}\n`);
	if (out.stderr !== "") process.stderr.write(out.stderr);
	process.exitCode = out.exitCode;
}

/**
 * `maina statusline <args>`. A render (no subcommand) always prints a line
 * and exits 0, even when the status line code itself fails to load.
 */
async function statusline(args: readonly string[]): Promise<void> {
	try {
		const { runStatuslineProcess } = await import("../statusline/system");
		process.exitCode = await runStatuslineProcess(args, import.meta.path);
	} catch {
		if (args.length === 0) process.stdout.write("Maina: off\n");
		else process.exitCode = 70;
	}
}

const [mode, ...rest] = process.argv.slice(2);

switch (mode) {
	case "statusline":
		await statusline(rest);
		break;
	case "mcp": {
		const [{ startServer }, { mcpRootResolver }] = await Promise.all([
			import("@mainahq/mcp"),
			import("../mcp-root"),
		]);
		const cwd = process.cwd();
		await startServer({
			argv: process.argv,
			env: process.env,
			cwd,
			home: homedir(),
			resolveRoot: mcpRootResolver({
				cwd,
				home: homedir(),
				hostProjectDir: process.env.CLAUDE_PROJECT_DIR,
			}),
		});
		break;
	}
	case "hook": {
		const route = routeHook(rest);
		if (route.type === "fail-closed") {
			// No adapter answers this hook: the fail-closed answer, never an allow.
			failClosed(route.host, route.event, route.cause);
			break;
		}
		try {
			const hooks = await import("../hook-system");
			const run = {
				claude: hooks.runClaudeHookProcess,
				codex: hooks.runCodexHookProcess,
				cursor: hooks.runCursorHookProcess,
			}[route.host];
			process.exitCode = await run(route.event);
		} catch {
			failClosed(route.host, route.event, "hook_crashed");
		}
		break;
	}
	case "cli": {
		// The status line needs the runtime, which the CLI package cannot load.
		if (rest[0] === "statusline") {
			await statusline(rest.slice(1));
			break;
		}
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
			"usage: maina mcp | hook [--host <claude|codex|cursor>] <event> | cli [args...] | statusline [...] | runtime-daemon ...\n",
		);
		process.exit(64);
}
