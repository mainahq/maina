/**
 * The system runtime works from an explicit root: its default root (the
 * `cwd` it is built with) is not a repository, so every call below proves
 * the tools never fall back to a working directory (FR-MCP-4).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpRuntime } from "../runtime";
import { systemRuntime } from "../system-runtime";
import { call, connect, expectEnvelope } from "./fixtures";

describe("systemRuntime works from an explicit root, not the process cwd", () => {
	let repo: string;
	let elsewhere: string;
	let runtime: McpRuntime;

	beforeAll(() => {
		repo = mkdtempSync(join(tmpdir(), "maina-mcp-repo-"));
		elsewhere = mkdtempSync(join(tmpdir(), "maina-mcp-elsewhere-"));
		spawnSync("git", ["init", "-q"], { cwd: repo });
		const feature = join(repo, ".maina", "features", "001-demo");
		mkdirSync(feature, { recursive: true });
		writeFileSync(
			join(feature, "spec.md"),
			"# Feature: demo\n\n## Acceptance Criteria\n\n- [ ] It works\n",
		);
		writeFileSync(join(repo, "receipt.json"), '{"not":"a receipt"}');
		// The default root would be `elsewhere`, which is not a repository:
		// every call below must use the explicit root instead.
		runtime = systemRuntime({ cwd: elsewhere, env: {} });
	});

	afterAll(() => {
		rmSync(repo, { recursive: true, force: true });
		rmSync(elsewhere, { recursive: true, force: true });
	});

	test("status", async () => {
		const client = await connect(runtime);
		const result = await call(client, "status", { root: repo });
		expectEnvelope(result, "status", repo);
	});

	test("spec_check", async () => {
		const client = await connect(runtime);
		const result = await call(client, "spec_check", {
			root: repo,
			paths: [".maina/features/001-demo"],
		});
		expectEnvelope(result, "spec_check", repo);
		const data = result.structuredContent?.data as {
			reports: Array<{ path: string }>;
		};
		expect(data.reports[0]?.path).toBe(".maina/features/001-demo");
	});

	test("receipt", async () => {
		const client = await connect(runtime);
		const result = await call(client, "receipt", {
			root: repo,
			paths: ["receipt.json"],
		});
		expectEnvelope(result, "receipt", repo);
		const data = result.structuredContent?.data as {
			receipts: Array<{ verified: boolean; code?: string }>;
		};
		expect(data.receipts[0]?.verified).toBe(false);
	});

	test("verify with an empty file list is skipped, never passed (#328)", async () => {
		const client = await connect(runtime);
		const result = await call(client, "verify", { root: repo, files: [] });
		expectEnvelope(result, "verify", repo);
		expect(result.structuredContent?.data).toMatchObject({
			status: "skipped",
			passed: false,
			scope: { kind: "files", files: [] },
			tools: [],
		});
	});

	test("an omitted root with a non-repo default is a structured error", async () => {
		const client = await connect(runtime);
		const result = await call(client, "status", {});
		expect(result.isError).toBe(true);
		expect(result.structuredContent?.error?.kind).toBe("no_root");
	});
});
