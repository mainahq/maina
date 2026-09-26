/**
 * The standalone runtime embeds tree-sitter (mainahq/maina#526).
 *
 * `bun build --compile` bundles modules, not the files a module reads at
 * run time, so the compiled executable has no `@vscode/tree-sitter-wasm` to
 * load. Without its grammars the gate sees every shell command as opaque
 * and asks, even for `rm -rf ~/.claude`, which it denies by default, and
 * the code graph cannot parse a file.
 *
 * This compiles a probe that starts up like the standalone entry and runs
 * it from a directory with no `node_modules` above it.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROBE = join(import.meta.dir, "fixtures", "tree-sitter-probe.ts");

/** The probe with the embedded WebAssembly on top of bun's own runtime. */
const PROBE_SIZE_BUDGET_BYTES = 160 * 1024 * 1024;

let dir = "";
let probe = "";

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), "maina-526-"));
	probe = join(dir, process.platform === "win32" ? "probe.exe" : "probe");
	const build = Bun.spawn(
		[process.execPath, "build", "--compile", PROBE, "--outfile", probe],
		{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
	);
	const [stderr, code] = await Promise.all([
		new Response(build.stderr).text(),
		build.exited,
	]);
	if (code !== 0) throw new Error(`bun build --compile failed: ${stderr}`);
}, 120_000);

afterAll(() => {
	if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

type ProbeResult = Readonly<{
	shell: unknown;
	echo: string;
	wipe: string;
	graph: Readonly<Record<string, string>>;
}>;

async function runProbe(): Promise<ProbeResult> {
	const cwd = join(dir, "project");
	const home = join(dir, "home");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(home, { recursive: true });
	// A git hook's GIT_DIR and friends would point git at this checkout.
	const env = {
		...Object.fromEntries(
			Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
		),
		HOME: home,
		USERPROFILE: home,
	};
	// The gate answers only inside a repository.
	Bun.spawnSync(["git", "init", "-q", cwd], {
		env,
		stdout: "ignore",
		stderr: "ignore",
	});
	const proc = Bun.spawn([probe, cwd, home], {
		cwd,
		env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Error(`probe exited ${code}: ${stderr}`);
	return JSON.parse(stdout.trim()) as ProbeResult;
}

describe("compiled standalone runtime", () => {
	test("loads the bash grammar and classifies shell commands", async () => {
		const result = await runProbe();
		expect([result.shell, result.echo, result.wipe]).toEqual([
			"ok",
			"allow",
			"deny",
		]);
	}, 30_000);

	test("parses every code-graph language", async () => {
		const { graph } = await runProbe();
		expect(graph).toEqual({
			typescript: "ok",
			tsx: "ok",
			javascript: "ok",
			python: "ok",
			go: "ok",
			rust: "ok",
			java: "ok",
		});
	}, 30_000);

	test("stays within its size budget", () => {
		expect(statSync(probe).size).toBeLessThan(PROBE_SIZE_BUDGET_BYTES);
	});
});
