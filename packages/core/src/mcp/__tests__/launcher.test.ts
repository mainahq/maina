/**
 * Tests for `detectLauncher`. Pin the `which` lookup so the result is
 * deterministic regardless of the runner machine's PATH (CI doesn't
 * have Bun installed by default; the developer's machine does).
 *
 * The most important behaviour this file locks down: the launcher's
 * `command` field is the **absolute resolved path** from `which`, not
 * the bare binary name. GUI MCP clients (Cursor, Zed, etc.) inherit
 * a stripped PATH on macOS and fail with `spawn bunx ENOENT` when given
 * a bare command. Resolving the path at install time fixes that.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { detectLauncher, resetLauncherCache } from "../launcher";

afterEach(() => {
	resetLauncherCache();
});

describe("detectLauncher — path resolution", () => {
	test("returns the ABSOLUTE bunx path (not the bare name) when Bun is on PATH", () => {
		const l = detectLauncher({
			which: (cmd) => (cmd === "bunx" ? "/opt/homebrew/bin/bunx" : null),
			noCache: true,
		});
		// Critical regression test: must be the absolute path so Cursor's
		// stripped-PATH spawn doesn't ENOENT.
		expect(l.command).toBe("/opt/homebrew/bin/bunx");
		expect(l.command).not.toBe("bunx");
		expect(l.args).toEqual(["@mainahq/cli", "--mcp"]);
	});

	test("returns the ABSOLUTE npx path when bunx is missing but npx exists", () => {
		const l = detectLauncher({
			which: (cmd) => (cmd === "npx" ? "/usr/local/bin/npx" : null),
			noCache: true,
		});
		expect(l.command).toBe("/usr/local/bin/npx");
		expect(l.command).not.toBe("npx");
	});

	test("prefers bunx over npx when both are on PATH", () => {
		const l = detectLauncher({
			which: (cmd) => {
				if (cmd === "bunx") return "/opt/homebrew/bin/bunx";
				if (cmd === "npx") return "/usr/local/bin/npx";
				return null;
			},
			noCache: true,
		});
		expect(l.command).toBe("/opt/homebrew/bin/bunx");
	});

	test("falls back to bare `npx` when nothing resolves (entry stays syntactically valid)", () => {
		const l = detectLauncher({
			which: () => null,
			noCache: true,
		});
		expect(l.command).toBe("npx");
	});
});

describe("detectLauncher — caching", () => {
	test("caches the first result so repeated calls don't re-probe", () => {
		let calls = 0;
		const which = (cmd: string) => {
			calls++;
			return cmd === "bunx" ? "/opt/homebrew/bin/bunx" : null;
		};
		detectLauncher({ which });
		detectLauncher({ which });
		detectLauncher({ which });
		// First call probed both bunx and npx (bunx hit, but the loop also
		// records npx miss before the cache is set). Subsequent calls
		// returned cache. So calls is bounded by 2 (first call only).
		expect(calls).toBeLessThanOrEqual(2);
	});

	test("noCache=true bypasses the cache", () => {
		let calls = 0;
		const which = (cmd: string) => {
			calls++;
			return cmd === "bunx" ? "/x/bunx" : null;
		};
		detectLauncher({ which, noCache: true });
		detectLauncher({ which, noCache: true });
		// Each call probes bunx (and possibly npx). Bounded by 4 (2 calls × 2 probes).
		expect(calls).toBeGreaterThanOrEqual(2);
		expect(calls).toBeLessThanOrEqual(4);
	});

	test("resetLauncherCache forces re-detection on next call", () => {
		detectLauncher({ which: () => "/x/bunx" });
		// Cached value used even with a different which.
		expect(detectLauncher({ which: () => null }).command).toBe("/x/bunx");

		resetLauncherCache();
		expect(detectLauncher({ which: () => null }).command).toBe("npx");
	});
});
