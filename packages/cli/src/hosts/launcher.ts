/**
 * Pick the launcher used in MCP client configs.
 *
 * Priority order, each preferring the most-reliable option:
 *
 *   1. **The running CLI, by absolute path** (#294), e.g.
 *      `/Users/x/.bun/bin/bun /Users/x/.bun/install/global/node_modules/
 *      @mainahq/cli/dist/index.js --mcp`. Used when this process *is* a
 *      stable install of the maina CLI (a global install or a checkout,
 *      not a throwaway `bunx`/`npx` copy). The host spawns the runtime
 *      directly, so neither a shebang (`env: bun` → 127 on a GUI PATH, P2)
 *      nor a registry lookup (unpublished pin, P3) stands in the way.
 *
 *   2. **Installed `maina` binary** (e.g. `/Users/x/.bun/bin/maina`). No
 *      package-manager spawn on every MCP request, no cold-start download,
 *      no Bun cache race when several MCP clients spawn the server at once.
 *
 *   3. **`bunx` with a pinned version** (e.g. `bunx @mainahq/cli@1.4.3
 *      --mcp`). 5-10× faster than `npx`, and the version pin lets `bunx`
 *      hit its cache more reliably on subsequent spawns. The pin is
 *      `VERSION` from core, the version the release publishes.
 *
 *   4. **`npx` with a pinned version** — universally available.
 *
 *   5. Bare `npx` last-resort fallback so the entry stays syntactically
 *      valid even on a machine with neither bun nor node.
 *
 * Two real bugs this module dodges:
 *
 *   - **Stripped GUI PATH on macOS.** Cursor / Zed / Claude Code desktop
 *     spawn subprocesses with a PATH that does NOT include
 *     `/opt/homebrew/bin` or `~/.bun/bin`. Every command is absolute.
 *
 *   - **bunx cache races on cold start.** Concurrent MCP-server spawns
 *     from a single editor restart hit the same `~/.bun/install/cache`
 *     and one of them errors with "failed copying files from cache to
 *     destination for package X". Direct launches dodge this entirely;
 *     pinned-version `bunx` reduces the window.
 */

import { accessSync, constants, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "@mainahq/core";

export interface Launcher {
	command: string;
	args: readonly string[];
}

/** A maina CLI process: the runtime binary and the entry file it runs. */
interface RunningCli {
	readonly execPath: string;
	readonly script: string;
}

const PINNED_PACKAGE = `@mainahq/cli@${VERSION}`;

interface DetectLauncherOptions {
	/**
	 * Overrideable PATH lookup. Returns the resolved binary path or null.
	 * Tests pass a fake; runtime uses `Bun.which`, or a PATH scan on Node.
	 */
	which?: (cmd: string) => string | null;
	/**
	 * The maina CLI this call runs in, or null when it is not a stable
	 * install. Defaults to inspecting the current process.
	 */
	self?: RunningCli | null;
	/** Skip the cache. Tests use this to assert detection runs each call. */
	noCache?: boolean;
}

let cached: Launcher | null = null;

export function detectLauncher(opts: DetectLauncherOptions = {}): Launcher {
	if (cached !== null && opts.noCache !== true) return cached;

	const self = opts.self !== undefined ? opts.self : currentCli();
	const which = opts.which ?? defaultWhich;

	let result: Launcher;
	if (self !== null) {
		// 1. This very CLI, runtime and entry by absolute path.
		result = { command: self.execPath, args: [self.script, "--mcp"] };
	} else {
		// 2. Direct maina binary — no package manager involved.
		const mainaPath = which("maina");
		if (mainaPath) {
			result = { command: mainaPath, args: ["--mcp"] };
		} else {
			// 3. bunx (preferred) or npx (fallback) — both with version pin so
			//    the package manager hits its cache reliably across spawns.
			const bunxPath = which("bunx");
			if (bunxPath) {
				result = { command: bunxPath, args: [PINNED_PACKAGE, "--mcp"] };
			} else {
				const npxPath = which("npx");
				if (npxPath) {
					result = { command: npxPath, args: [PINNED_PACKAGE, "--mcp"] };
				} else {
					// 4. Truly nothing on PATH. Emit a syntactically valid entry
					//    that the user can edit after they install Node/Bun.
					result = { command: "npx", args: [PINNED_PACKAGE, "--mcp"] };
				}
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
 * Returns true if the launcher runs maina directly (the running CLI or the
 * installed `maina` binary), false if it's a package-manager invocation.
 * CLI consumers use this to decide whether to print the "consider `bun
 * install -g @mainahq/cli` for faster startup" tip after `mcp add`.
 */
export function isDirectBinary(launcher: Launcher): boolean {
	return (
		launcher.args[launcher.args.length - 1] === "--mcp" &&
		!launcher.args.some((a) => a.startsWith("@mainahq/cli"))
	);
}

interface RunningCliInput {
	/** Absolute path of the runtime (`process.execPath`). */
	readonly execPath: string;
	/** The script the runtime was started with (`process.argv[1]`). */
	readonly argv1: string | undefined;
	/** Root of this `@mainahq/cli` package, or null when unknown. */
	readonly cliRoot: string | null;
	/** The OS temp dir; package runners unpack throwaway copies under it. */
	readonly tmpDir: string;
	/** `realpath`, or null when the path does not resolve. */
	readonly realpath: (path: string) => string | null;
}

/**
 * The running process as a launchable maina CLI, or null. It qualifies only
 * when its entry resolves to this package's own entry (compiled or source)
 * and that package is not a throwaway copy a package runner will delete.
 */
export function runningCli(input: RunningCliInput): RunningCli | null {
	if (input.argv1 === undefined || input.cliRoot === null) return null;
	const script = input.realpath(input.argv1);
	const root = input.realpath(input.cliRoot) ?? input.cliRoot;
	if (script === null) return null;
	const entries = [
		join(root, "dist", "index.js"),
		join(root, "src", "index.ts"),
	];
	if (!entries.includes(script)) return null;
	const tmp = input.realpath(input.tmpDir) ?? input.tmpDir;
	const ephemeral =
		script.startsWith(`${tmp}${sep}`) ||
		script.startsWith(`${input.tmpDir}${sep}`) ||
		PACKAGE_RUNNER_CACHE.test(script);
	return ephemeral ? null : { execPath: input.execPath, script };
}

/** Where bunx, npx and pnpm dlx unpack the copies they run. */
const PACKAGE_RUNNER_CACHE =
	/[/\\](bunx-[^/\\]*|_npx|dlx-[^/\\]*)[/\\]|[/\\]\.bun[/\\]install[/\\]cache[/\\]|[/\\]pnpm[/\\]dlx[/\\]/i;

function currentCli(): RunningCli | null {
	return runningCli({
		execPath: process.execPath,
		argv1: process.argv[1],
		cliRoot: packageRoot(dirname(fileURLToPath(import.meta.url))),
		tmpDir: tmpdir(),
		realpath: safeRealpath,
	});
}

/** Nearest ancestor holding a package.json: the cli package, in src or dist. */
function packageRoot(from: string): string | null {
	let dir = from;
	for (;;) {
		if (existsSync(join(dir, "package.json"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function safeRealpath(path: string): string | null {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}

function defaultWhich(cmd: string): string | null {
	const bunGlobal = (
		globalThis as { Bun?: { which?: (c: string) => string | null } }
	).Bun;
	if (bunGlobal?.which) return bunGlobal.which(cmd);
	// Node: scan PATH for an executable file.
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (dir === "") continue;
		const candidate = join(dir, cmd);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// not here
		}
	}
	return null;
}
