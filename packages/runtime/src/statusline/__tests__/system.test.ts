/**
 * The real status line process (FR-RET-1, #347): the standalone entry's
 * `statusline` mode, run as a host runs it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import cliPackage from "@mainahq/cli/package.json" with { type: "json" };
import { fixedGate } from "../../__tests__/support";
import { userEndpoint } from "../../registry";
import { type Runtime, startRuntime } from "../../server";
import { statuslineHostCommand } from "../system";

const MAIN = join(import.meta.dir, "..", "..", "standalone", "main.ts");

let dirs: string[] = [];
let runtime: Runtime | null = null;

afterEach(() => {
	runtime?.stop();
	runtime = null;
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	dirs = [];
});

function tempDir(): string {
	// Short: a Unix socket path under it must stay within the OS limit.
	const dir = mkdtempSync(join(tmpdir(), "msl-"));
	dirs.push(dir);
	return dir;
}

async function run(
	args: readonly string[],
	env: Readonly<Record<string, string>>,
	stdin = "",
): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
	const proc = Bun.spawn(["bun", MAIN, ...args], {
		env: { ...process.env, NO_COLOR: "1", ...env },
		stdin: new TextEncoder().encode(stdin),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr };
}

describe("statuslineHostCommand", () => {
	test("from source: bun runs the standalone entry", () => {
		expect(
			statuslineHostCommand(
				"file:///repo/packages/runtime/src/statusline/system.ts",
				"/usr/local/bin/bun",
				"/repo/packages/runtime/src/standalone/main.ts",
			),
		).toBe(
			"/usr/local/bin/bun /repo/packages/runtime/src/standalone/main.ts cli statusline",
		);
	});

	test("compiled: the runtime executable itself, quoted for the shell", () => {
		expect(
			statuslineHostCommand(
				"file:///$bunfs/root/maina",
				"/Users/Jo Doe/.maina/runtime/2.0.0/maina",
				"/$bunfs/root/maina",
			),
		).toBe("'/Users/Jo Doe/.maina/runtime/2.0.0/maina' cli statusline");
	});
});

describe("maina statusline (process)", () => {
	test("with no runtime running it prints Maina: off and exits 0", async () => {
		const out = await run(
			["cli", "statusline"],
			{ XDG_RUNTIME_DIR: tempDir() },
			'{"session_id":"s1","cwd":"/nowhere"}',
		);
		expect(out).toEqual({ code: 0, stdout: "Maina: off\n", stderr: "" });
	});

	test("garbage on stdin is still one line and exit 0", async () => {
		const out = await run(
			["statusline"],
			{ XDG_RUNTIME_DIR: tempDir() },
			"\u0000not json",
		);
		expect(out.code).toBe(0);
		expect(out.stdout).toBe("Maina: off\n");
	});

	test("with the runtime up it shows it on", async () => {
		const xdg = tempDir();
		const started = startRuntime(
			{ gate: fixedGate("allow") },
			{
				endpoint: userEndpoint({ XDG_RUNTIME_DIR: xdg }, cliPackage.version),
				version: cliPackage.version,
				idleTtlMs: 60_000,
			},
		);
		if (!started.ok) throw new Error(JSON.stringify(started.error));
		runtime = started.value;
		const out = await run(
			["cli", "statusline"],
			{ XDG_RUNTIME_DIR: xdg },
			JSON.stringify({ session_id: "s1", cwd: tempDir() }),
		);
		expect(out).toEqual({
			code: 0,
			stdout: "Maina: on · no decisions yet\n",
			stderr: "",
		});
	});

	test("install and remove round-trip the user's settings", async () => {
		const home = tempDir();
		const settings = join(home, ".claude", "settings.json");
		const original = `${JSON.stringify({ model: "opus", env: { A: "1" } }, null, 2)}\n`;
		await Bun.write(settings, original);
		const env = { HOME: home, XDG_RUNTIME_DIR: tempDir() };

		const installed = await run(
			["statusline", "install", "--scope", "user"],
			env,
		);
		expect(installed.code).toBe(0);
		const entry = JSON.parse(readFileSync(settings, "utf-8")).statusLine;
		expect(entry.type).toBe("command");
		expect(entry.command).toEndWith(`${MAIN} cli statusline`);

		const removed = await run(["statusline", "remove", "--scope", "user"], env);
		expect(removed.code).toBe(0);
		expect(readFileSync(settings, "utf-8")).toBe(original);
	});

	test("a usage error exits 64 and writes nothing", async () => {
		const home = tempDir();
		writeFileSync(join(home, "marker"), "");
		const out = await run(["statusline", "install", "--scope", "team"], {
			HOME: home,
		});
		expect(out.code).toBe(64);
		expect(out.stderr).toContain("unknown scope team");
	});
});
