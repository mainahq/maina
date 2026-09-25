/**
 * doctor v2 host health (FR-INS-6): the pure half. Which entries doctor
 * launches, what it launches, and how a probe outcome becomes checks.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	evaluateLaunch,
	launchEnv,
	launchSpecOf,
	modelCheck,
	rootCheck,
} from "../health";
import { ignoredTargets } from "../targets";

const ctx = { home: "/h", cwd: "/p", platform: "linux" as const };
const FIX = "maina mcp add --client cursor --scope global";

describe("launchSpecOf", () => {
	test("reads the stdio shape most hosts use", () => {
		expect(
			launchSpecOf({
				command: "/b/bun",
				args: ["x.js", "--mcp"],
				env: { A: "1" },
			}),
		).toEqual({
			ok: true,
			value: { command: "/b/bun", args: ["x.js", "--mcp"], env: { A: "1" } },
		});
	});

	test("reads Zed's nested command and Continue's transport", () => {
		expect(
			launchSpecOf({
				source: "custom",
				command: { path: "/m", args: ["--mcp"] },
			}),
		).toEqual({ ok: true, value: { command: "/m", args: ["--mcp"], env: {} } });
		expect(
			launchSpecOf({
				name: "maina",
				transport: { type: "stdio", command: "/m", args: ["--mcp"] },
			}),
		).toEqual({ ok: true, value: { command: "/m", args: ["--mcp"], env: {} } });
	});

	test("an entry with no stdio command is invalid", () => {
		expect(launchSpecOf({ url: "http://x" }).ok).toBe(false);
		expect(launchSpecOf({ command: "" }).ok).toBe(false);
		expect(launchSpecOf("maina").ok).toBe(false);
	});
});

describe("launchEnv", () => {
	test("darwin and linux get the GUI PATH plus HOME, nothing inherited", () => {
		const env = launchEnv("darwin", "/h", { PATH: "/h/.bun/bin", SECRET: "x" });
		expect(env.mode).toBe("minimal");
		expect(env.env).toEqual({
			PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
			HOME: "/h",
		});
	});

	test("a platform without a known GUI env inherits the caller's", () => {
		const env = launchEnv("win32", "/h", { PATH: "C:\\bin" });
		expect(env.mode).toBe("inherited");
		expect(env.env.PATH).toBe("C:\\bin");
	});
});

describe("evaluateLaunch", () => {
	const ids = (checks: readonly { id: string; status: string }[]) =>
		checks.map((c) => `${c.id}:${c.status}`);

	test("not found stops at launch", () => {
		const checks = evaluateLaunch(
			{ kind: "not-found", command: "bun", path: "/usr/bin" },
			"2.0.0",
			FIX,
		);
		expect(ids(checks)).toEqual(["launch:fail"]);
		expect(checks[0]?.fix).toBe(FIX);
	});

	test("a timeout is a spawned launch with a failed handshake", () => {
		const checks = evaluateLaunch(
			{ kind: "timeout", executable: "/m", timeoutMs: 10_000 },
			"2.0.0",
			FIX,
		);
		expect(ids(checks)).toEqual(["launch:pass", "handshake:fail"]);
	});

	test("a server that is not maina fails the runtime check", () => {
		const checks = evaluateLaunch(
			{
				kind: "ready",
				executable: "/m",
				handshakeMs: 5,
				protocolVersion: "2024-11-05",
				serverName: "other",
				serverVersion: "1.0.0",
			},
			"2.0.0",
			FIX,
		);
		expect(ids(checks)).toEqual([
			"launch:pass",
			"handshake:pass",
			"runtime:fail",
		]);
	});
});

describe("rootCheck", () => {
	test("outside a git repo it warns with a fix", () => {
		const c = rootCheck("/p", null, true);
		expect(c.status).toBe("warn");
		expect(c.fix).toBe("git init");
	});

	test("a subdirectory of the repo warns: hosts spawn at the top", () => {
		const c = rootCheck("/p/sub", "/p", true);
		expect(c.status).toBe("warn");
		expect(c.fix).toBe("cd /p && maina doctor");
	});

	test("a repo without .maina warns to run setup", () => {
		expect(rootCheck("/p", "/p", false).fix).toBe("maina setup");
	});
});

describe("modelCheck", () => {
	test("present but unverifiable is a warning with a verify fix", () => {
		const c = modelCheck({ state: "present", dir: "/h/.maina/models" });
		expect(c.status).toBe("warn");
		expect(c.fix).toBe("maina model verify");
	});
});

describe("ignoredTargets", () => {
	test("Claude's settings files are where installers wrongly wrote (P1)", () => {
		expect(ignoredTargets("claude", ctx).map((t) => [t.scope, t.path])).toEqual(
			[
				["global", join("/h", ".claude", "settings.json")],
				["project", join("/p", ".claude", "settings.json")],
				["project", join("/p", ".claude", "settings.local.json")],
			],
		);
	});

	test("hosts with no known stray files have none", () => {
		expect(ignoredTargets("cursor", ctx)).toEqual([]);
	});
});
