/**
 * Tests for `detectLauncher`. Pin the `which` lookup so the result is
 * deterministic regardless of the runner machine's PATH (CI doesn't
 * have Bun installed by default; the developer's machine does).
 *
 * Two real bugs this file locks down regression tests for:
 *
 *   1. **Stripped GUI PATH**: launcher must use the absolute resolved
 *      path from `which`, not the bare binary name. Cursor/Zed spawn
 *      with stripped PATH and ENOENT on bare commands.
 *
 *   2. **bunx cache races**: prefer the installed `maina` binary over
 *      bunx. When falling back to bunx/npx, pin the package version so
 *      the package manager hits its cache reliably across spawns.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { VERSION } from "@mainahq/core";
import {
	detectLauncher,
	isDirectBinary,
	resetLauncherCache,
	runningCli,
} from "../launcher";

const PKG_VERSION = VERSION;

afterEach(() => {
	resetLauncherCache();
});

describe("detectLauncher — priority order", () => {
	test("prefers installed maina binary over bunx (avoids cache race entirely)", () => {
		const l = detectLauncher({
			which: (cmd) => {
				if (cmd === "maina") return "/Users/x/.bun/bin/maina";
				if (cmd === "bunx") return "/opt/homebrew/bin/bunx";
				return null;
			},
			noCache: true,
		});
		expect(l.command).toBe("/Users/x/.bun/bin/maina");
		expect(l.args).toEqual(["--mcp"]);
		expect(isDirectBinary(l)).toBe(true);
	});

	test("falls back to bunx with pinned version when maina binary is absent", () => {
		const l = detectLauncher({
			which: (cmd) => (cmd === "bunx" ? "/opt/homebrew/bin/bunx" : null),
			noCache: true,
		});
		expect(l.command).toBe("/opt/homebrew/bin/bunx");
		expect(l.args).toEqual([`@mainahq/cli@${PKG_VERSION}`, "--mcp"]);
		expect(isDirectBinary(l)).toBe(false);
	});

	test("falls back to npx with pinned version when maina + bunx absent", () => {
		const l = detectLauncher({
			which: (cmd) => (cmd === "npx" ? "/usr/local/bin/npx" : null),
			noCache: true,
		});
		expect(l.command).toBe("/usr/local/bin/npx");
		expect(l.args).toEqual([`@mainahq/cli@${PKG_VERSION}`, "--mcp"]);
	});

	test("emits bare `npx` last-resort fallback when nothing resolves", () => {
		const l = detectLauncher({ which: () => null, noCache: true });
		expect(l.command).toBe("npx");
		expect(l.args).toEqual([`@mainahq/cli@${PKG_VERSION}`, "--mcp"]);
	});
});

describe("detectLauncher — absolute path contract (Cursor ENOENT regression)", () => {
	test("maina path is absolute, never bare", () => {
		const l = detectLauncher({
			which: (cmd) => (cmd === "maina" ? "/Users/x/.bun/bin/maina" : null),
			noCache: true,
		});
		expect(l.command).toBe("/Users/x/.bun/bin/maina");
		expect(l.command).not.toBe("maina");
	});

	test("bunx path is absolute, never bare", () => {
		const l = detectLauncher({
			which: (cmd) => (cmd === "bunx" ? "/opt/homebrew/bin/bunx" : null),
			noCache: true,
		});
		expect(l.command).toBe("/opt/homebrew/bin/bunx");
		expect(l.command).not.toBe("bunx");
	});
});

describe("detectLauncher — caching", () => {
	test("caches the first result so repeated calls don't re-probe", () => {
		let calls = 0;
		const which = (cmd: string) => {
			calls++;
			return cmd === "maina" ? "/x/maina" : null;
		};
		detectLauncher({ which });
		detectLauncher({ which });
		detectLauncher({ which });
		// Bounded: first call probes maina (hit, short-circuits). Subsequent
		// calls return cache. So calls should be 1 (just the maina probe).
		expect(calls).toBe(1);
	});

	test("noCache=true bypasses the cache", () => {
		let calls = 0;
		const which = (cmd: string) => {
			calls++;
			return cmd === "maina" ? "/x/maina" : null;
		};
		detectLauncher({ which, noCache: true });
		detectLauncher({ which, noCache: true });
		expect(calls).toBe(2);
	});

	test("resetLauncherCache forces re-detection on next call", () => {
		detectLauncher({ which: () => "/x/maina" });
		// Cached value used even with a different which.
		expect(detectLauncher({ which: () => null }).command).toBe("/x/maina");

		resetLauncherCache();
		// Re-probes; nothing on PATH so emits bare npx fallback.
		expect(detectLauncher({ which: () => null }).command).toBe("npx");
	});
});

describe("isDirectBinary helper", () => {
	test("true for direct binary, false for package-manager invocation", () => {
		expect(isDirectBinary({ command: "/x/maina", args: ["--mcp"] })).toBe(true);
		expect(
			isDirectBinary({
				command: "/x/bunx",
				args: ["@mainahq/cli@1.0.0", "--mcp"],
			}),
		).toBe(false);
	});
});

// ── Self-launch (#294, P2/P3) ─────────────────────────────────────────────

const BUN = "/Users/x/.bun/bin/bun";
const GLOBAL_ENTRY =
	"/Users/x/.bun/install/global/node_modules/@mainahq/cli/dist/index.js";

describe("detectLauncher — the running CLI launches itself", () => {
	test("a stable install is spawned through the absolute runtime, not a shebang (P2)", () => {
		// `~/.bun/bin/maina` starts with a shebang that needs bun or node on
		// PATH, which a GUI-launched host does not have. The runtime this CLI
		// runs under, by absolute path, needs no PATH at all.
		const l = detectLauncher({
			self: { execPath: BUN, script: GLOBAL_ENTRY },
			which: (cmd) => (cmd === "maina" ? "/Users/x/.bun/bin/maina" : null),
			noCache: true,
		});
		expect(l).toEqual({ command: BUN, args: [GLOBAL_ENTRY, "--mcp"] });
		expect(isDirectBinary(l)).toBe(true);
	});

	test("beats a registry pin, so an unreleased build still starts (P3)", () => {
		const l = detectLauncher({
			self: { execPath: BUN, script: "/repo/packages/cli/src/index.ts" },
			which: (cmd) => (cmd === "bunx" ? "/Users/x/.bun/bin/bunx" : null),
			noCache: true,
		});
		expect(l.command).toBe(BUN);
		expect(l.args).not.toContain(`@mainahq/cli@${PKG_VERSION}`);
	});

	test("without a stable running CLI the PATH chain is unchanged", () => {
		const l = detectLauncher({
			self: null,
			which: (cmd) => (cmd === "bunx" ? "/Users/x/.bun/bin/bunx" : null),
			noCache: true,
		});
		expect(l.args).toEqual([`@mainahq/cli@${PKG_VERSION}`, "--mcp"]);
	});
});

describe("runningCli", () => {
	const cliRoot = "/Users/x/.bun/install/global/node_modules/@mainahq/cli";
	const base = {
		execPath: BUN,
		cliRoot,
		tmpDir: "/var/folders/ab/T",
		realpath: (p: string): string | null => p,
	};

	test("recognises the compiled entry of this package", () => {
		expect(runningCli({ ...base, argv1: `${cliRoot}/dist/index.js` })).toEqual({
			execPath: BUN,
			script: `${cliRoot}/dist/index.js`,
		});
	});

	test("recognises the source entry in a checkout", () => {
		const r = runningCli({
			...base,
			cliRoot: "/repo/packages/cli",
			argv1: "/repo/packages/cli/src/index.ts",
		});
		expect(r?.script).toBe("/repo/packages/cli/src/index.ts");
	});

	test("follows the bin symlink to the real entry", () => {
		const r = runningCli({
			...base,
			argv1: "/Users/x/.bun/bin/maina",
			realpath: (p) =>
				p === "/Users/x/.bun/bin/maina" ? `${cliRoot}/dist/index.js` : p,
		});
		expect(r?.script).toBe(`${cliRoot}/dist/index.js`);
	});

	test("ignores a process that is not the maina CLI (test runners, other tools)", () => {
		expect(
			runningCli({ ...base, argv1: "/repo/src/__tests__/a.test.ts" }),
		).toBeNull();
		expect(runningCli({ ...base, argv1: undefined })).toBeNull();
		expect(
			runningCli({ ...base, argv1: "/x", realpath: () => null }),
		).toBeNull();
		expect(
			runningCli({ ...base, cliRoot: null, argv1: GLOBAL_ENTRY }),
		).toBeNull();
	});

	test("ignores throwaway package-runner copies (bunx, npx)", () => {
		const bunxRoot =
			"/var/folders/ab/T/bunx-501-@mainahq/cli@1.8.1/node_modules/@mainahq/cli";
		expect(
			runningCli({
				...base,
				cliRoot: bunxRoot,
				argv1: `${bunxRoot}/dist/index.js`,
			}),
		).toBeNull();
		const cacheRoot =
			"/Users/x/.bun/install/cache/@mainahq/cli@1.8.1@@@1/node_modules/@mainahq/cli";
		expect(
			runningCli({
				...base,
				cliRoot: cacheRoot,
				argv1: `${cacheRoot}/dist/index.js`,
			}),
		).toBeNull();
		const npxRoot = "/Users/x/.npm/_npx/0f3a/node_modules/@mainahq/cli";
		expect(
			runningCli({
				...base,
				cliRoot: npxRoot,
				argv1: `${npxRoot}/dist/index.js`,
			}),
		).toBeNull();
	});
});
