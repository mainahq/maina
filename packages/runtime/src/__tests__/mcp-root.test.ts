/**
 * The standalone MCP server resolves a tool call's root with the runtime's
 * root resolution (FR-INS-3): explicit root, then the host project dir,
 * then the working directory, each mapped to its git top level.
 */

import { describe, expect, test } from "bun:test";
import { mcpRootResolver } from "../mcp-root";

const probe = (repos: Readonly<Record<string, string>>) => ({
	toplevel: async (dir: string) => repos[dir] ?? null,
});

describe("mcpRootResolver", () => {
	const repos = {
		"/work/app/src": "/work/app",
		"/host/project": "/host/project",
		"/cwd": "/cwd",
	};

	test("an explicit root wins and maps to its git top level", async () => {
		const resolve = mcpRootResolver(
			{ cwd: "/cwd", hostProjectDir: "/host/project" },
			probe(repos),
		);
		expect(await resolve("/work/app/src")).toEqual({
			ok: true,
			value: "/work/app",
		});
	});

	test("without one, the host project dir, then the cwd", async () => {
		expect(
			await mcpRootResolver(
				{ cwd: "/cwd", hostProjectDir: "/host/project" },
				probe(repos),
			)(undefined),
		).toEqual({ ok: true, value: "/host/project" });
		expect(
			await mcpRootResolver({ cwd: "/cwd" }, probe(repos))(undefined),
		).toEqual({ ok: true, value: "/cwd" });
	});

	test("no repository is a no_root error naming what was tried", async () => {
		const result = await mcpRootResolver(
			{ cwd: "/nowhere" },
			probe(repos),
		)(undefined);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("no_root");
			expect(result.error.message).toContain("/nowhere");
		}
	});
});
