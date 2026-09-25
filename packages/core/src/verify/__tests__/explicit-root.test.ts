/**
 * Verify engine takes an explicit root and injected environment (#290).
 *
 * The functional core never falls back to `process.cwd()` or reads
 * `process.env`: every verify entry point receives the repository root from
 * its caller, and the environment for spawned checkers is injected.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCoverage } from "../coverage";
import { detectTool, detectTools, isToolAvailable } from "../detect";
import { filterIgnoredFiles } from "../ignore";
import { runMutation } from "../mutation";
import { runPipeline } from "../pipeline";
import { gatherVerificationProof } from "../proof";
import { runSecretlint } from "../secretlint";
import { runSemgrep } from "../semgrep";
import { detectSlop } from "../slop";
import { runSonar } from "../sonar";
import { syntaxGuard } from "../syntax-guard";
import { runWikiLintTool } from "../tools/wiki-lint-runner";
import { runTrivy } from "../trivy";
import { runTypecheck } from "../typecheck";
import { captureScreenshot } from "../visual";

function writeScript(path: string, body: string): void {
	writeFileSync(path, `#!/bin/sh\n${body}\n`);
	chmodSync(path, 0o755);
}

describe("verify entry points require an explicit root", () => {
	test("calls without a root do not type-check", () => {
		// Never invoked: `bun run typecheck` enforces the directives below.
		const withoutRoot: ReadonlyArray<() => unknown> = [
			// @ts-expect-error root is required
			() => runPipeline({ files: [] }),
			// @ts-expect-error root is required
			() => runPipeline(),
			// @ts-expect-error root is required
			() => gatherVerificationProof({}),
			// @ts-expect-error root is required
			() => detectSlop([], {}),
			// @ts-expect-error root is required
			() => syntaxGuard([]),
			// @ts-expect-error root is required
			() => filterIgnoredFiles([]),
			// @ts-expect-error root is required
			() => runSemgrep({ files: [] }),
			// @ts-expect-error root is required
			() => runSecretlint({ files: [] }),
			// @ts-expect-error root is required
			() => runTrivy({}),
			// @ts-expect-error root is required
			() => runSonar({}),
			// @ts-expect-error root is required
			() => runMutation({}),
			// @ts-expect-error root is required
			() => runCoverage({}),
			// @ts-expect-error root is required
			() => detectTool("pmd"),
			// @ts-expect-error root is required
			() => isToolAvailable("pmd"),
			// @ts-expect-error root is required
			() => captureScreenshot("http://x", "/tmp/x.png", {}),
		];
		expect(withoutRoot).toHaveLength(15);
	});
});

// Detection tries the global PATH first; only a root-local `pmd` can prove the
// root is honoured, so skip where a global `pmd` would win.
const pmdOnPath = Bun.which("pmd") !== null;

describe.skipIf(pmdOnPath)(
	"tool detection resolves local binaries from the given root",
	() => {
		let root: string;

		beforeEach(() => {
			root = mkdtempSync(join(tmpdir(), "maina-explicit-root-"));
			const bin = join(root, "node_modules", ".bin");
			mkdirSync(bin, { recursive: true });
			// `pmd` is not expected on PATH, so only the root-local copy can match.
			writeScript(join(bin, "pmd"), 'echo "PMD 7.1.0"');
		});

		afterEach(() => {
			rmSync(root, { recursive: true, force: true });
		});

		test("detectTool finds <root>/node_modules/.bin", async () => {
			const tool = await detectTool("pmd", root);
			expect(tool.available).toBe(true);
			expect(tool.command).toBe(join(root, "node_modules", ".bin", "pmd"));
			expect(tool.version).toBe("7.1.0");
		});

		test("isToolAvailable honours the root", async () => {
			expect(await isToolAvailable("pmd", root)).toBe(true);
		});

		test("detectTools takes the root before the language filter", async () => {
			const tools = await detectTools(root, ["java"]);
			const pmd = tools.find((t) => t.name === "pmd");
			expect(pmd?.available).toBe(true);
			expect(tools.some((t) => t.name === "biome")).toBe(false);
		});
	},
);

describe("runTypecheck uses the injected environment", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "maina-typecheck-env-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("spawns the checker with the given env plus NO_COLOR", async () => {
		const script = join(root, "checker.sh");
		writeScript(
			script,
			'echo "marker=$MAINA_ENV_MARKER color=$NO_COLOR"\nexit 1',
		);

		const result = await runTypecheck(["app.py"], root, {
			language: "python",
			command: script,
			env: { PATH: "/usr/bin:/bin", MAINA_ENV_MARKER: "injected" },
		});

		expect(result.skipped).toBe(false);
		expect(result.findings[0]?.message).toBe("marker=injected color=1");
	});

	test("per-project tsc (workspace path) also gets the injected env", async () => {
		// The default TypeScript route runs one `tsc -p` per nearest tsconfig;
		// it must honour the injected env just like the single-command path.
		writeFileSync(join(root, "tsconfig.json"), "{}");
		const bin = join(root, "node_modules", ".bin");
		mkdirSync(bin, { recursive: true });
		writeScript(
			join(bin, "tsc"),
			'echo "src/a.ts(1,1): error TS9999: marker=$MAINA_ENV_MARKER color=$NO_COLOR"\nexit 2',
		);

		const result = await runTypecheck(["src/a.ts"], root, {
			env: { PATH: "/usr/bin:/bin", MAINA_ENV_MARKER: "injected" },
		});

		expect(result.skipped).toBe(false);
		expect(result.findings[0]?.message).toContain("marker=injected color=1");
	});
});

describe("captureScreenshot runs Playwright from the explicit root", () => {
	let root: string;
	let fakeBin: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "maina-visual-root-"));
		fakeBin = mkdtempSync(join(tmpdir(), "maina-fake-npx-"));
		// Fake `npx` records its working directory into the output path
		// (its last argument), standing in for `npx playwright screenshot`.
		writeScript(
			join(fakeBin, "npx"),
			'for a in "$@"; do out="$a"; done\npwd -P > "$out"',
		);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
		rmSync(fakeBin, { recursive: true, force: true });
	});

	test("spawns npx with cwd = root, not the process cwd", async () => {
		const out = join(root, "shots", "home.png");
		// Bun resolves spawn commands against the PATH it started with, so run
		// the call in a child whose PATH puts the fake `npx` first and whose
		// cwd is deliberately not the root.
		const script = [
			`import { captureScreenshot } from ${JSON.stringify(join(import.meta.dir, "..", "visual.ts"))};`,
			`const r = await captureScreenshot("http://localhost", ${JSON.stringify(out)}, { root: ${JSON.stringify(root)}, available: true });`,
			"process.stdout.write(JSON.stringify(r));",
		].join("\n");
		const proc = Bun.spawn([process.execPath, "-e", script], {
			cwd: fakeBin,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
		});
		const stdout = await new Response(proc.stdout).text();
		await proc.exited;

		expect(JSON.parse(stdout).captured).toBe(true);
		expect(readFileSync(out, "utf8").trim()).toBe(realpathSync(root));
	});
});

describe("wiki lint resolves the pipeline's absolute .maina dir", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "maina-wiki-root-"));
		mkdirSync(join(root, ".maina", "wiki"), { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("an absolute mainaDir (the pipeline default) is not re-joined onto the root", async () => {
		// runPipeline defaults mainaDir to join(root, ".maina") and the CLI
		// passes the same absolute path; the wiki must still be found.
		const result = await runWikiLintTool({
			cwd: root,
			mainaDir: join(root, ".maina"),
		});
		expect(result.skipped).toBe(false);
	});

	test("a relative mainaDir still resolves against the root", async () => {
		const result = await runWikiLintTool({ cwd: root, mainaDir: ".maina" });
		expect(result.skipped).toBe(false);
	});
});
