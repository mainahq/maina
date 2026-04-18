/**
 * Pick the launcher used in MCP client configs.
 *
 * Priority order, each preferring the most-reliable option:
 *
 *   1. **Installed `maina` binary** (e.g. `/Users/x/.bun/bin/maina`) —
 *      best by far. No package-manager spawn on every MCP request, no
 *      cold-start download, no Bun cache race when multiple MCP clients
 *      spawn the server concurrently. Requires the user to have run
 *      `bun install -g @mainahq/cli` (or `npm i -g`).
 *
 *   2. **`bunx` with a pinned version** (e.g. `bunx @mainahq/cli@1.4.3
 *      --mcp`). 5-10× faster than `npx`, and the version pin lets `bunx`
 *      hit its cache more reliably on subsequent spawns.
 *
 *   3. **`npx` with a pinned version** — universally available.
 *
 *   4. Bare `npx` last-resort fallback so the entry stays syntactically
 *      valid even on a machine with neither bun nor node.
 *
 * Two real bugs this module dodges:
 *
 *   - **Stripped GUI PATH on macOS.** Cursor / Zed / Claude Code desktop
 *     spawn subprocesses with a PATH that does NOT include
 *     `/opt/homebrew/bin` or `~/.bun/bin`. We resolve to the absolute
 *     path via `Bun.which` so spawning never ENOENTs.
 *
 *   - **bunx cache races on cold start.** Concurrent MCP-server spawns
 *     from a single editor restart hit the same `~/.bun/install/cache`
 *     and one of them errors with "failed copying files from cache to
 *     destination for package X". Direct-binary launches dodge this
 *     entirely; pinned-version `bunx` reduces the window.
 */

import pkg from "../../package.json";

const PKG_VERSION = pkg.version;

export interface Launcher {
	command: string;
	args: readonly string[];
}

const PINNED_PACKAGE = `@mainahq/cli@${PKG_VERSION}`;

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

	// 1. Direct maina binary — fastest, no package manager involved.
	const mainaPath = which("maina");
	let result: Launcher;
	if (mainaPath) {
		result = { command: mainaPath, args: ["--mcp"] };
	} else {
		// 2. bunx (preferred) or npx (fallback) — both with version pin so
		//    the package manager hits its cache reliably across spawns.
		const bunxPath = which("bunx");
		if (bunxPath) {
			result = { command: bunxPath, args: [PINNED_PACKAGE, "--mcp"] };
		} else {
			const npxPath = which("npx");
			if (npxPath) {
				result = { command: npxPath, args: [PINNED_PACKAGE, "--mcp"] };
			} else {
				// 3. Truly nothing on PATH. Emit a syntactically valid entry
				//    that the user can edit after they install Node/Bun.
				result = { command: "npx", args: [PINNED_PACKAGE, "--mcp"] };
			}
		}
	}

	if (opts.noCache !== true) cached = result;
	return result;
}

/** Reset the cached launcher detection. Tests use this between cases. */
export function resetLauncherCache(): void {
	cached = null;
}

/**
 * Returns true if the launcher is the direct `maina` binary (preferred
 * path), false if it's a package-manager invocation. CLI consumers use
 * this to decide whether to print the "consider `bun install -g
 * @mainahq/cli` for faster startup" tip after `mcp add`.
 */
export function isDirectBinary(launcher: Launcher): boolean {
	return launcher.args.length === 1 && launcher.args[0] === "--mcp";
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
