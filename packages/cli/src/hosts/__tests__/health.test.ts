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
	localCliCopies,
	modelCheck,
	rootCheck,
	trustedProjectLaunch,
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

describe("trustedProjectLaunch", () => {
	const repo = ["/p", "/private/p"];
	const spec = (command: string, args: string[], env = {}) => ({
		command,
		args,
		env,
	});

	test("maina's own launcher outside the repo is trusted", () => {
		expect(trustedProjectLaunch(spec("/u/bin/maina", ["--mcp"]), repo)).toBe(
			true,
		);
		expect(trustedProjectLaunch(spec("maina", ["--mcp"]), repo)).toBe(true);
		expect(
			trustedProjectLaunch(
				spec("/u/bin/bunx", ["@mainahq/cli@1.0.0", "--mcp"]),
				repo,
			),
		).toBe(true);
		expect(
			trustedProjectLaunch(
				spec("/u/bin/bun", ["/u/cli/dist/index.js", "--mcp"]),
				repo,
			),
		).toBe(true);
	});

	test("an arbitrary command is not", () => {
		expect(
			trustedProjectLaunch(spec("sh", ["-c", "touch /tmp/pwned"]), repo),
		).toBe(false);
	});

	test("a launcher-shaped command the repo itself ships is not", () => {
		expect(trustedProjectLaunch(spec("./bin/maina", ["--mcp"]), repo)).toBe(
			false,
		);
		expect(trustedProjectLaunch(spec("bin/maina", ["--mcp"]), repo)).toBe(
			false,
		);
		expect(trustedProjectLaunch(spec("/p/bin/maina", ["--mcp"]), repo)).toBe(
			false,
		);
		expect(
			trustedProjectLaunch(spec("/u/x/../../p/bin/maina", ["--mcp"]), repo),
		).toBe(false);
		expect(
			trustedProjectLaunch(spec("/private/p/bin/maina", ["--mcp"]), repo),
		).toBe(false);
		expect(
			trustedProjectLaunch(
				spec("/u/bin/bun", ["/p/cli/dist/index.js", "--mcp"]),
				repo,
			),
		).toBe(false);
	});

	test("an entry that sets its own env is not: it can preload code or move PATH", () => {
		expect(
			trustedProjectLaunch(
				spec("/u/bin/npx", ["@mainahq/cli@1.0.0", "--mcp"], {
					NODE_OPTIONS: "--require /p/evil.js",
				}),
				repo,
			),
		).toBe(false);
		expect(
			trustedProjectLaunch(spec("maina", ["--mcp"], { PATH: "/p/bin" }), repo),
		).toBe(false);
	});

	// #418: npx resolves `@mainahq/cli@X` to a copy the repo ships in its own
	// node_modules when that copy's version matches, so the pinned
	// package-runner form runs repo code there.
	test("a package-runner launch is not trusted when the repo ships its own @mainahq/cli", () => {
		const shipped = { repoShipsCli: true };
		expect(
			trustedProjectLaunch(
				spec("/u/bin/npx", ["@mainahq/cli@1.0.0", "--mcp"]),
				repo,
				shipped,
			),
		).toBe(false);
		expect(
			trustedProjectLaunch(
				spec("/u/bin/bunx", ["@mainahq/cli@1.0.0", "--mcp"]),
				repo,
				shipped,
			),
		).toBe(false);
		expect(
			trustedProjectLaunch(spec("npx", ["@mainahq/cli@1.0.0", "--mcp"]), repo, {
				repoShipsCli: false,
			}),
		).toBe(true);
	});

	test("launches that never consult node_modules stay trusted when the repo ships @mainahq/cli", () => {
		const shipped = { repoShipsCli: true };
		expect(
			trustedProjectLaunch(spec("/u/bin/maina", ["--mcp"]), repo, shipped),
		).toBe(true);
		expect(
			trustedProjectLaunch(
				spec("/u/bin/bun", ["/u/cli/dist/index.js", "--mcp"]),
				repo,
				shipped,
			),
		).toBe(true);
	});
});

describe("localCliCopies", () => {
	const copy = (dir: string) => join(dir, "node_modules", "@mainahq", "cli");

	test("every copy a runner started in cwd could resolve, up to the repo root", () => {
		expect(localCliCopies("/p/packages/app", "/p")).toEqual([
			copy("/p/packages/app"),
			copy("/p/packages"),
			copy("/p"),
		]);
	});

	test("only cwd's own outside a git repository", () => {
		expect(localCliCopies("/p", null)).toEqual([copy("/p")]);
	});

	test("only cwd's own when cwd is not below the repo root", () => {
		expect(localCliCopies("/elsewhere", "/p")).toEqual([copy("/elsewhere")]);
	});
});
