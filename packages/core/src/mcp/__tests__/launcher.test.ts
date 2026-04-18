/**
 * Tests for `detectLauncher`. Pin the `which` lookup so the result is
 * deterministic regardless of the runner machine's PATH (CI doesn't
 * have Bun installed by default; the developer's machine does).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { detectLauncher, resetLauncherCache } from "../launcher";

afterEach(() => {
	resetLauncherCache();
});

describe("detectLauncher", () => {
	test("returns bunx when Bun is on PATH", () => {
		const l = detectLauncher({
			which: (cmd) => (cmd === "bunx" ? "/usr/local/bin/bunx" : null),
			noCache: true,
		});
		expect(l.command).toBe("bunx");
		expect(l.args).toEqual(["@mainahq/cli", "--mcp"]);
	});

	test("falls back to npx when Bun is not on PATH", () => {
		const l = detectLauncher({
			which: () => null,
			noCache: true,
		});
		expect(l.command).toBe("npx");
		expect(l.args).toEqual(["@mainahq/cli", "--mcp"]);
	});

	test("caches the first result so repeated calls don't re-probe", () => {
		let calls = 0;
		const which = (cmd: string) => {
			calls++;
			return cmd === "bunx" ? "/x/bunx" : null;
		};
		detectLauncher({ which });
		detectLauncher({ which });
		detectLauncher({ which });
		// First call probed; subsequent calls returned cache.
		expect(calls).toBe(1);
	});

	test("noCache=true bypasses the cache", () => {
		let calls = 0;
		const which = (cmd: string) => {
			calls++;
			return cmd === "bunx" ? "/x/bunx" : null;
		};
		detectLauncher({ which, noCache: true });
		detectLauncher({ which, noCache: true });
		expect(calls).toBe(2);
	});

	test("resetLauncherCache forces re-detection on next call", () => {
		detectLauncher({ which: () => "/x/bunx" });
		expect(detectLauncher({ which: () => null }).command).toBe("bunx"); // cached

		resetLauncherCache();
		expect(detectLauncher({ which: () => null }).command).toBe("npx"); // re-probed
	});
});
