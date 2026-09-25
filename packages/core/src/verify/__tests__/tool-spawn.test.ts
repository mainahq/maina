/**
 * Tool runners spawn the path detection resolved, and a spawn failure is an
 * honest skip (#389).
 *
 * `detectTool` falls back to `<root>/node_modules/.bin`, so a tool installed
 * only in the repository is reported available. The runners used to spawn the
 * bare command name anyway: the spawn failed with ENOENT and the runner
 * reported `skipped: false` with zero findings, a silent pass.
 *
 * Each case runs the runner in a child Bun process whose PATH holds only
 * `/usr/bin:/bin`. Bun resolves spawn commands against the PATH it started
 * with, so this guarantees no globally installed copy of the tool can stand
 * in for the root-local fake.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const RESTRICTED_PATH = "/usr/bin:/bin";

interface RunnerCase {
	/** Module under `verify/` exporting the runner. */
	module: string;
	/** Exported runner function name. */
	fn: string;
	/** Binary name detection looks for in node_modules/.bin. */
	bin: string;
	/** Shell body the fake tool runs (after the `--version` probe). */
	body: string;
	/** Tool name the parsed finding carries. */
	tool: string;
	/** Substring of the parsed finding's message. */
	message: string;
	/** Report file (relative to root) and its JSON, for report-file tools. */
	report?: { path: string; json: string };
}

const SARIF = JSON.stringify({
	runs: [
		{
			results: [
				{
					ruleId: "fake.rule",
					level: "error",
					message: { text: "fake semgrep finding" },
					locations: [
						{
							physicalLocation: {
								artifactLocation: { uri: "src/app.ts" },
								region: { startLine: 3 },
							},
						},
					],
				},
			],
		},
	],
});

const TRIVY = JSON.stringify({
	Results: [
		{
			Target: "package-lock.json",
			Vulnerabilities: [
				{
					VulnerabilityID: "CVE-0000-0001",
					PkgName: "fake",
					InstalledVersion: "1.0.0",
					Severity: "HIGH",
					Title: "fake trivy finding",
				},
			],
		},
	],
});

const SECRETLINT = JSON.stringify([
	{
		filePath: "src/app.ts",
		messages: [
			{
				ruleId: "fake-secret",
				message: "fake secretlint finding",
				loc: { start: { line: 2, column: 1 } },
				severity: 2,
			},
		],
	},
]);

const SONAR = JSON.stringify({
	issues: [
		{
			rule: "fake:rule",
			severity: "MAJOR",
			component: "src/app.ts",
			line: 4,
			message: "fake sonar finding",
		},
	],
});

const STRYKER = JSON.stringify({
	files: {
		"src/app.ts": {
			mutants: [
				{
					mutatorName: "Fake",
					status: "Survived",
					description: "fake stryker finding",
					location: { start: { line: 5 } },
				},
			],
		},
	},
});

const DIFF_COVER = JSON.stringify({
	src_stats: {
		"src/app.ts": { violation_lines: [6], percent_covered: 50 },
	},
});

/** Shell snippet writing `json` to stdout, or to `target` when given. */
function heredoc(json: string, target?: string): string {
	const redirect = target ? ` > ${target}` : "";
	return `cat${redirect} <<'MAINA_EOF'\n${json}\nMAINA_EOF`;
}

const CASES: readonly RunnerCase[] = [
	{
		module: "semgrep",
		fn: "runSemgrep",
		bin: "semgrep",
		body: heredoc(SARIF),
		tool: "semgrep",
		message: "fake semgrep finding",
	},
	{
		module: "trivy",
		fn: "runTrivy",
		bin: "trivy",
		body: heredoc(TRIVY),
		tool: "trivy",
		message: "fake trivy finding",
	},
	{
		module: "secretlint",
		fn: "runSecretlint",
		bin: "secretlint",
		body: heredoc(SECRETLINT),
		tool: "secretlint",
		message: "fake secretlint finding",
	},
	{
		module: "sonar",
		fn: "runSonar",
		bin: "sonar-scanner",
		body: `mkdir -p .scannerwork\n${heredoc(SONAR, ".scannerwork/sonar-report.json")}`,
		tool: "sonarqube",
		message: "fake sonar finding",
		report: { path: ".scannerwork/sonar-report.json", json: SONAR },
	},
	{
		module: "mutation",
		fn: "runMutation",
		bin: "stryker",
		body: `mkdir -p reports/mutation\n${heredoc(STRYKER, "reports/mutation/mutation.json")}`,
		tool: "stryker",
		message: "fake stryker finding",
		report: { path: "reports/mutation/mutation.json", json: STRYKER },
	},
	{
		module: "coverage",
		fn: "runCoverage",
		bin: "diff-cover",
		body: heredoc(DIFF_COVER),
		tool: "diff-cover",
		message: "not covered by tests",
	},
];

interface RunnerOutcome {
	findings: Array<{ tool: string; message: string }>;
	skipped: boolean;
	notice?: string;
}

function writeFakeTool(path: string, body: string): void {
	writeFileSync(
		path,
		`#!/bin/sh\nif [ "$1" = "--version" ]; then echo "9.9.9"; exit 0; fi\n${body}\n`,
	);
	chmodSync(path, 0o755);
}

/** Run `runner(options)` in a child Bun with a PATH that has none of the tools. */
async function runInChild(
	c: RunnerCase,
	options: Record<string, unknown>,
): Promise<RunnerOutcome> {
	const modulePath = join(import.meta.dir, "..", `${c.module}.ts`);
	const script = [
		`import { ${c.fn} } from ${JSON.stringify(modulePath)};`,
		`const r = await ${c.fn}(${JSON.stringify(options)});`,
		"process.stdout.write(JSON.stringify(r));",
	].join("\n");
	const proc = Bun.spawn([process.execPath, "-e", script], {
		cwd: tmpdir(),
		stdout: "pipe",
		stderr: "pipe",
		env: { HOME: process.env.HOME ?? "", PATH: RESTRICTED_PATH },
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`child exited ${code}: ${stderr}`);
	}
	return JSON.parse(stdout) as RunnerOutcome;
}

describe("runners spawn the tool path resolved by detection (#389)", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "maina-tool-spawn-"));
		mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	for (const c of CASES) {
		test(`${c.fn} runs a root-local ${c.bin} found only in node_modules/.bin`, async () => {
			writeFakeTool(join(root, "node_modules", ".bin", c.bin), c.body);

			const result = await runInChild(c, {
				cwd: root,
				baseBranch: "HEAD",
			});

			expect(result.skipped).toBe(false);
			expect(result.findings).toHaveLength(1);
			expect(result.findings[0]?.tool).toBe(c.tool);
			expect(result.findings[0]?.message).toContain(c.message);
		}, 20_000);

		test(`${c.fn} runs a root-local ${c.bin} when the root is a relative path`, async () => {
			// Detection probes relative to the process cwd, but the runner spawns
			// with cwd = root: a relative resolved path would miss (ENOENT).
			writeFakeTool(join(root, "node_modules", ".bin", c.bin), c.body);

			const result = await runInChild(c, {
				cwd: relative(tmpdir(), root),
				baseBranch: "HEAD",
			});

			expect(result.notice).toBeUndefined();
			expect(result.skipped).toBe(false);
			expect(result.findings).toHaveLength(1);
		}, 20_000);

		test(`${c.fn} honours a pre-resolved command from the pipeline`, async () => {
			const toolPath = join(root, "tools", c.bin);
			mkdirSync(join(root, "tools"), { recursive: true });
			writeFakeTool(toolPath, c.body);

			const result = await runInChild(c, {
				cwd: root,
				baseBranch: "HEAD",
				available: true,
				command: toolPath,
			});

			expect(result.skipped).toBe(false);
			expect(result.findings).toHaveLength(1);
		}, 20_000);

		test(`${c.fn} reports a spawn failure as skipped with a notice, never a silent pass`, async () => {
			// Detected available, but the binary cannot be started (ENOENT).
			const result = await runInChild(c, {
				cwd: root,
				baseBranch: "HEAD",
				available: true,
			});

			expect(result.skipped).toBe(true);
			expect(result.findings).toEqual([]);
			expect(result.notice).toContain(c.bin);
			expect(result.notice).toMatch(/could not be started/);
		}, 20_000);

		test(`${c.fn} reports a run that exits non-zero with no results as skipped, never a silent pass`, async () => {
			// Started fine, then failed (e.g. rules fetch, bad config): no output.
			writeFakeTool(
				join(root, "node_modules", ".bin", c.bin),
				'echo "boom: config unreachable" >&2\nexit 2',
			);

			const result = await runInChild(c, { cwd: root, baseBranch: "HEAD" });

			expect(result.skipped).toBe(true);
			expect(result.findings).toEqual([]);
			expect(result.notice).toContain(c.tool);
			expect(result.notice).toContain("exited with code 2");
			expect(result.notice).toContain("boom: config unreachable");
		}, 20_000);

		test(`${c.fn} never reuses a stale report or unparseable output from a failed run`, async () => {
			writeFakeTool(
				join(root, "node_modules", ".bin", c.bin),
				'echo "not json"\necho "boom" >&2\nexit 2',
			);
			const report = c.report;
			if (report) {
				// A previous run's report, older than this invocation.
				const reportPath = join(root, report.path);
				mkdirSync(dirname(reportPath), { recursive: true });
				writeFileSync(reportPath, report.json);
				const past = new Date(Date.now() - 60 * 60 * 1000);
				utimesSync(reportPath, past, past);
			}

			const result = await runInChild(c, { cwd: root, baseBranch: "HEAD" });

			expect(result.findings).toEqual([]);
			expect(result.skipped).toBe(true);
			expect(result.notice).toContain("exited with code 2");
		}, 20_000);

		test(`${c.fn} keeps findings when the tool exits non-zero because it found issues`, async () => {
			writeFakeTool(
				join(root, "node_modules", ".bin", c.bin),
				`${c.body}\nexit 1`,
			);

			const result = await runInChild(c, { cwd: root, baseBranch: "HEAD" });

			expect(result.notice).toBeUndefined();
			expect(result.skipped).toBe(false);
			expect(result.findings).toHaveLength(1);
		}, 20_000);
	}
});
