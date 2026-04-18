/**
 * Pick the launcher used in MCP client configs.
 *
 * Three concerns this module gets right at install time:
 *
 *   1. Prefer `bunx` when available (5-10× faster startup), `npx` as the
 *      universally-available fallback.
 *
 *   2. Write the **absolute resolved path** of the launcher into the
 *      config — not the bare binary name. GUI-launched AI clients
 *      (Cursor, Claude Code, Zed, etc.) inherit a stripped PATH on macOS
 *      that does NOT include `/opt/homebrew/bin` or `~/.bun/bin`, so a
 *      bare `command: "bunx"` produces `spawn bunx ENOENT` even though
 *      the binary is installed for the user. Resolving via `Bun.which`
 *      gives us the full path the OS will actually find.
 *
 *   3. Cache the detection so each install round-trip probes PATH at
 *      most once. Tests inject a fake `which` to keep snapshots stable.
 *
 * Real-world signal that drove this: cursor MCP logs showed
 * `Connection failed: spawn bunx ENOENT` repeatedly against an entry
 * we wrote with bare `bunx`. Switching to the absolute path fixes it.
 */

export interface Launcher {
	command: string;
	args: readonly string[];
}

const ARGS: readonly string[] = ["@mainahq/cli", "--mcp"];

export interface DetectLauncherOptions {
	/**
	 * Overrideable PATH lookup. Returns the resolved binary path or null.
	 * Tests pass a fake; runtime uses `Bun.which` (always available since
	 * the maina CLI itself runs under Bun).
	 */
	which?: (cmd: string) => string | null;
	/** Skip the cache. Tests use this to assert detection runs each call. */
	noCache?: boolean;
}

let cached: Launcher | null = null;

export function detectLauncher(opts: DetectLauncherOptions = {}): Launcher {
	if (cached !== null && opts.noCache !== true) return cached;

	const which = opts.which ?? defaultWhich;
	// Probe in preference order. Use the absolute resolved path when found
	// so MCP clients with stripped spawn PATHs (Cursor, Zed, etc.) can
	// actually find the binary.
	const bunxPath = which("bunx");
	const npxPath = which("npx");
	let result: Launcher;
	if (bunxPath) {
		result = { command: bunxPath, args: ARGS };
	} else if (npxPath) {
		result = { command: npxPath, args: ARGS };
	} else {
		// Truly nothing on PATH. Fall back to bare `npx` so the entry is
		// at least syntactically valid; the user can edit it after they
		// install Node/Bun.
		result = { command: "npx", args: ARGS };
	}

	if (opts.noCache !== true) cached = result;
	return result;
}

/** Reset the cached launcher detection. Tests use this between cases. */
export function resetLauncherCache(): void {
	cached = null;
}

function defaultWhich(cmd: string): string | null {
	// Bun.which is sync and returns null when the binary isn't on PATH.
	// The maina CLI is bundled and run via Bun, so this is always defined
	// at runtime; tests inject their own.
	const bunGlobal = (
		globalThis as { Bun?: { which?: (c: string) => string | null } }
	).Bun;
	if (bunGlobal?.which) return bunGlobal.which(cmd);
	return null;
}
