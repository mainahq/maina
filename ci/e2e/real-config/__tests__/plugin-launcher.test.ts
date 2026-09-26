/**
 * Plugin launch path with the real standalone runtime (v1 task 2.3,
 * FR-INS-1, FR-INS-7; fixes P2 and P4 for the plugin path).
 *
 * A host plugin's MCP entry is `<plugin>/launcher/launch.sh mcp`. This
 * compiles the standalone runtime for this machine, serves it from a local
 * artifact server, and spawns that entry exactly as a GUI-launched host
 * does (PATH without bun, CLAUDE_PLUGIN_DATA set):
 *
 *   - P2: nothing on the GUI PATH is needed: no bun, no node.
 *   - P4: once the runtime is cached, `initialize` answers within the cold
 *     start budget and `verify` succeeds.
 *
 * Runs in the `plugin` cells of the e2e workflow (and locally when no cell
 * filter is set).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	artifactName,
	compileStandalone,
} from "../../../../packages/runtime/build/standalone";
import {
	type ArtifactServer,
	createReleaseKey,
	currentTarget,
	type Staged,
	stageLauncher,
	startArtifactServer,
	TEST_VERSION,
} from "../../../../packages/runtime/launcher/__tests__/fixture";
import { runClaudeHook } from "../../../../packages/runtime/src/claude-hook";
import { runCodexHook } from "../../../../packages/runtime/src/codex-hook";
import { runCursorHook } from "../../../../packages/runtime/src/cursor-hook";
import { failClosedHook } from "../../../../packages/runtime/src/standalone/hook-fallback";
import { currentOs, hostEnv } from "../env";
import { createWorkspace, probeLaunch, type Workspace } from "../matrix";

const cellPath = process.env.E2E_INSTALL_PATH;
const cellHost = process.env.E2E_HOST;
const runsHere =
	process.platform !== "win32" &&
	(cellPath === undefined || cellPath === "plugin") &&
	(cellHost === undefined || cellHost === "claude-code");

describe.skipIf(!runsHere)(
	"plugin launcher with the standalone runtime",
	() => {
		const os = currentOs(process.platform);
		let workspace: Workspace;
		let server: ArtifactServer;
		let staged: Staged;

		beforeAll(async () => {
			if (!os.ok) throw new Error(os.error);
			workspace = createWorkspace(os.value, false);
			const target = currentTarget();
			const outfile = join(workspace.root, artifactName(TEST_VERSION, target));
			const built = await compileStandalone({ target, outfile });
			if (!built.ok) throw new Error(built.error.message);
			const bytes = new Uint8Array(readFileSync(outfile));
			const path = `/runtime-v${TEST_VERSION}/${artifactName(TEST_VERSION, target)}`;
			server = startArtifactServer({ [path]: bytes });
			staged = stageLauncher({
				target,
				pinned: bytes,
				url: `${server.url}${path}`,
				key: createReleaseKey(),
			});
			chmodSync(join(staged.dir, "launch.sh"), 0o755);
		}, 120_000);

		afterAll(() => {
			server?.stop();
			if (staged)
				rmSync(join(staged.dir, ".."), { recursive: true, force: true });
			if (workspace) rmSync(workspace.root, { recursive: true, force: true });
		});

		const launch = () => ({
			command: join(staged.dir, "launch.sh"),
			args: ["mcp"],
			env: { CLAUDE_PLUGIN_DATA: staged.data },
			source: join(staged.dir, "..", ".mcp.json"),
		});

		const env = () =>
			hostEnv("minimal", {
				os: os.ok ? os.value : "linux",
				home: workspace.home,
				shellEnv: workspace.shellEnv,
			});

		test("first launch installs the verified runtime and starts MCP", async () => {
			// The first spawn downloads (and, on macOS, the first exec is scanned),
			// so only a start is required here, not the cold-start budget.
			const first = await probeLaunch(launch(), env(), workspace.cwd, {
				coldStartBudgetMs: 60_000,
			});
			expect(first.error).toBeUndefined();
			expect(first.started).toBe(true);
			expect(first.toolCallOk).toBe(true);
		}, 90_000);

		test("P2 + P4: from cache, a GUI-PATH launch starts within budget and verifies", async () => {
			const cached = await probeLaunch(launch(), env(), workspace.cwd);
			expect(cached.error).toBeUndefined();
			expect(cached.started).toBe(true);
			expect(cached.toolCallOk).toBe(true);
			expect(cached.handshakeMs).toBeLessThanOrEqual(1_500);
		}, 60_000);

		test("hook and CLI modes reach the same runtime", async () => {
			const run = async (args: readonly string[]) => {
				const proc = Bun.spawn([join(staged.dir, "launch.sh"), ...args], {
					cwd: workspace.cwd,
					env: { ...env(), CLAUDE_PLUGIN_DATA: staged.data },
					stdin: "ignore",
					stdout: "pipe",
					stderr: "pipe",
				});
				const [stdout, exitCode] = await Promise.all([
					new Response(proc.stdout).text(),
					proc.exited,
				]);
				return { stdout, exitCode };
			};
			// Empty stdin reaches the Claude Code (#309), Cursor (#310) and
			// Codex (#475) adapters, which ask (Codex: deny): the compiled
			// runtime loaded the host's hook path rather than crashing into the
			// launcher's fail-closed answer.
			const unreachable = {
				evaluate: async (): Promise<never> => {
					throw new Error("unreachable: malformed input asks");
				},
				sessionSummary: async () => undefined,
			};
			const hook = await run(["hook", "--host", "claude", "PreToolUse"]);
			expect(hook.exitCode).toBe(0);
			const asked = await runClaudeHook("", unreachable, "PreToolUse");
			expect(hook.stdout).toBe(asked.output.stdout);
			expect(hook.stdout.trim()).not.toBe(
				failClosedHook("claude", "PreToolUse", "hook_crashed").line,
			);
			const codex = await run(["hook", "--host", "codex", "PreToolUse"]);
			const codexDenied = await runCodexHook("", unreachable, "PreToolUse");
			expect(codex.exitCode).toBe(codexDenied.output.exitCode);
			expect(codex.stdout).toBe(codexDenied.output.stdout);
			expect(codex.stdout.trim()).not.toBe(
				failClosedHook("codex", "PreToolUse", "hook_crashed").line,
			);
			const cursor = await run([
				"hook",
				"--host",
				"cursor",
				"beforeShellExecution",
			]);
			expect(cursor.exitCode).toBe(0);
			const cursorAsked = await runCursorHook(
				"",
				unreachable,
				"beforeShellExecution",
			);
			expect(cursor.stdout).toBe(cursorAsked.output.stdout);
			expect(cursor.stdout.trim()).not.toBe(
				failClosedHook("cursor", "beforeShellExecution", "hook_crashed").line,
			);
			const cli = await run(["cli", "--version"]);
			expect(cli.exitCode).toBe(0);
			expect(cli.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
		}, 60_000);
	},
);
