/**
 * The real status line (FR-RET-1, #347): `maina statusline` over the
 * machine. The render port asks this user's resident runtime for its status
 * (never spawning one) and reads the session's summary from the decision
 * log; the settings edits go through the host config filesystem.
 *
 * The standalone runtime's `statusline` mode (and `cli statusline`) runs
 * `runStatuslineProcess`.
 */

import { homedir } from "node:os";
import cliPackage from "@mainahq/cli/package.json" with { type: "json" };
import {
	runStatusline,
	type StatuslinePorts,
} from "@mainahq/cli/src/commands/statusline";
import { nodeHostFs } from "@mainahq/cli/src/hosts/apply";
import { isCompiledModule } from "../lifecycle";
import { userEndpoint } from "../registry";
import { renderStatusline } from "./render";
import { parseHostInput, probeRuntime, readStatuslineState } from "./state";

/**
 * How long the line waits for the runtime's status. A warm runtime answers
 * in well under 10 ms; one that takes longer than this is reported degraded.
 */
const PROBE_TIMEOUT_MS = 250;

/** `arg` quoted for a POSIX shell when it needs it. */
function shellQuote(arg: string): string {
	return /^[A-Za-z0-9_./:@%+=-]+$/.test(arg)
		? arg
		: `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command a host runs for the status line: the compiled runtime itself,
 * or bun running the standalone entry from source.
 */
export function statuslineHostCommand(
	moduleUrl: string,
	execPath: string,
	entry: string,
): string {
	const argv = isCompiledModule(moduleUrl)
		? [execPath, "cli", "statusline"]
		: [execPath, entry, "cli", "statusline"];
	return argv.map(shellQuote).join(" ");
}

async function render(
	hostInput: string,
	env: Readonly<Record<string, string | undefined>>,
): Promise<string> {
	const version = cliPackage.version;
	const endpoint = userEndpoint(env, version);
	const state = await readStatuslineState(parseHostInput(hostInput), {
		probe: (sessionId) =>
			probeRuntime({
				address: endpoint.address,
				version,
				timeoutMs: PROBE_TIMEOUT_MS,
				...(sessionId === undefined ? {} : { sessionId }),
			}),
		summary: async ({ cwd, sessionId }) => {
			// Without a session there is nothing of this session to count.
			if (cwd === undefined || sessionId === undefined) return null;
			// Loaded only with a runtime up: the "off" line stays cheap.
			const { readSessionSummary } = await import("../hook-system");
			return readSessionSummary(cwd, sessionId);
		},
	});
	return renderStatusline(state, { color: env.NO_COLOR === undefined });
}

function systemStatuslinePorts(entry: string): StatuslinePorts {
	const env = process.env;
	return {
		render: (hostInput) => render(hostInput, env),
		// A terminal is not a host: nothing will ever arrive on it.
		readStdin: () =>
			process.stdin.isTTY ? Promise.resolve("") : Bun.stdin.text(),
		stdout: (text) => process.stdout.write(text),
		stderr: (text) => process.stderr.write(text),
		fs: nodeHostFs(),
		home: homedir(),
		cwd: process.cwd(),
		command: statuslineHostCommand(import.meta.url, process.execPath, entry),
	};
}

/**
 * One `maina statusline <args>` process; resolves to the exit code. `entry`
 * is the standalone entry file, for the command a host runs from source.
 */
export function runStatuslineProcess(
	args: readonly string[],
	entry: string,
): Promise<number> {
	return runStatusline(args, systemStatuslinePorts(entry));
}
