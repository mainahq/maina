/**
 * The standalone MCP server resolves a tool call's root with the runtime's
 * root resolution (FR-INS-3): explicit root, then the host project dir,
 * then the client's MCP roots, then the working directory, each mapped to
 * its git top level.
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

	test("without a host project dir, the client's MCP roots come before the cwd", async () => {
		// An Agent Plugins client (VS Code agent mode) starts the server in the
		// plugin root and names the workspace as its MCP roots.
		const roots = async () => ["file:///nowhere", "file:///work/app/src"];
		expect(
			await mcpRootResolver({ cwd: "/cwd" }, probe(repos))(undefined, {
				mcpRoots: roots,
			}),
		).toEqual({ ok: true, value: "/work/app" });
		// No roots: the cwd, as before.
		expect(
			await mcpRootResolver({ cwd: "/cwd" }, probe(repos))(undefined, {
				mcpRoots: async () => [],
			}),
		).toEqual({ ok: true, value: "/cwd" });
	});

	test("the client is asked for roots only when nothing above them decides", async () => {
		let asked = 0;
		const hints = {
			mcpRoots: async () => {
				asked += 1;
				return ["/work/app/src"];
			},
		};
		const resolve = mcpRootResolver(
			{ cwd: "/cwd", hostProjectDir: "/host/project" },
			probe(repos),
		);
		expect(await resolve(undefined, hints)).toEqual({
			ok: true,
			value: "/host/project",
		});
		expect(await resolve("/cwd", hints)).toEqual({ ok: true, value: "/cwd" });
		expect(asked).toBe(0);
	});

	test("MCP roots outside any repository refuse instead of falling back to the cwd", async () => {
		const result = await mcpRootResolver({ cwd: "/cwd" }, probe(repos))(
			undefined,
			{ mcpRoots: async () => ["file:///nowhere"] },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("mcp");
			expect(result.error.message).toContain("/nowhere");
		}
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

	test("a relative explicit root is refused, never resolved against the cwd", async () => {
		const result = await mcpRootResolver(
			{ cwd: "/work/app/src" },
			probe({ ...repos, "app/src": "/work/app" }),
		)("app/src");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("no_root");
			expect(result.error.message).toContain("absolute");
		}
	});
});
