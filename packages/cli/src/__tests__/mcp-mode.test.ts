/**
 * `maina --mcp` keeps serving when something throws outside a request
 * (#542, FR-MCP-5): a detached timer throw or an unhandled rejection is
 * logged on stderr and the server keeps answering. The CLI's crash
 * handlers (report, then `process.exit`) are for CLI commands only.
 */

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "maina-cli-mcp-mode-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ENTRY = join(import.meta.dir, "..", "index.ts");

/**
 * Preloaded before the CLI entry: once the process serves MCP (startServer
 * sets MAINA_MCP_SERVER), a timer throws and a detached promise rejects.
 */
const STRAY = join(dir, "stray.ts");
writeFileSync(
	STRAY,
	[
		"const poll = setInterval(() => {",
		'	if (process.env.MAINA_MCP_SERVER !== "1") return;',
		"	clearInterval(poll);",
		'	setTimeout(() => { throw new Error("stray timer throw"); }, 0);',
		'	setTimeout(() => { void Promise.reject(new Error("stray rejection")); }, 20);',
		"}, 5);",
	].join("\n"),
);

test("a stray async throw neither exits nor stops the server", async () => {
	const proc = Bun.spawn(
		[process.execPath, "--preload", STRAY, ENTRY, "--mcp"],
		{
			cwd: dir,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, MAINA_DEBUG: "0", DEBUG: "0", NODE_DEBUG: "0" },
		},
	);
	let stderr = "";
	const stderrDone = (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of proc.stderr) {
			stderr += decoder.decode(chunk, { stream: true });
		}
	})();
	try {
		// Both stray errors have fired (or the process died) before the
		// client speaks.
		const deadline = Date.now() + 10_000;
		while (
			!(
				stderr.includes("stray timer throw") &&
				stderr.includes("stray rejection")
			) &&
			proc.exitCode === null &&
			Date.now() < deadline
		) {
			await Bun.sleep(25);
		}
		expect(proc.exitCode).toBeNull();

		proc.stdin.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "mcp-mode-test", version: "0" },
				},
			})}\n`,
		);
		await proc.stdin.flush();

		const decoder = new TextDecoder();
		let buffer = "";
		let initialized: { result?: { serverInfo?: { name: string } } } | null =
			null;
		for await (const chunk of proc.stdout) {
			buffer += decoder.decode(chunk, { stream: true });
			const line = buffer.split("\n").find((l) => l.includes('"id":1'));
			if (line !== undefined) {
				initialized = JSON.parse(line);
				break;
			}
		}
		expect(initialized?.result?.serverInfo?.name).toBe("maina");
		expect(proc.exitCode).toBeNull();
		expect(stderr).toContain("stray timer throw");
		expect(stderr).toContain("stray rejection");
		expect(stderr).toContain("still serving");
	} finally {
		proc.kill();
		await proc.exited;
		await stderrDone;
	}
}, 20_000);
