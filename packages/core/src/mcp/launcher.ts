/**
 * Pick the launcher used in MCP client configs (`bunx` vs `npx`).
 *
 * Both work, but they have different trade-offs:
 *   - `bunx` starts roughly 5-10× faster but only exists if Bun is on PATH.
 *   - `npx` is universally available (ships with npm which ships with Node).
 *
 * Real-world signal: dogfooding `maina mcp add` on a developer machine that
 * already had `bunx`-rooted MCP entries surfaced that the prior hard-coded
 * `npx` would *regress* their existing config. Detection at install time
 * fixes this without forcing a launcher choice on users who don't have Bun.
 *
 * The detection runs once per process and caches its result. Tests inject
 * a `which` override so the cache key (and Bun.which side effects) are
 * predictable.
 */

export interface Launcher {
	command: string;
	args: readonly string[];
}

const NPX_LAUNCHER: Launcher = {
	command: "npx",
	args: ["@mainahq/cli", "--mcp"],
};

const BUNX_LAUNCHER: Launcher = {
	command: "bunx",
	args: ["@mainahq/cli", "--mcp"],
};

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
	const result = which("bunx") ? BUNX_LAUNCHER : NPX_LAUNCHER;

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
