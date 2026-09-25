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
import pkg from "../../../package.json";
import {
	detectLauncher,
	isDirectBinary,
	resetLauncherCache,
} from "../launcher";

const PKG_VERSION = pkg.version;

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
