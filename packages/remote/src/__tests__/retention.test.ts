/**
 * Retention (FR-REM-3, FR-PRIV-2): a pull request job keeps nothing of the
 * code it ran over, and nothing it logs names that code or a path.
 *
 * - Every job runs in its own private scratch directory: the checkout, the
 *   temp directory, `$HOME` and the XDG directories of every tool it runs
 *   all sit inside it, and it is deleted (and confirmed gone) when the job
 *   ends, however it ends.
 * - The job's log is one JSON line per job with the job kind, repository,
 *   pull request, head commit, outcome and duration: never a message, a
 *   file name, a workspace path or a line of code. Detailed errors belong
 *   to the job's result (stdout), not the log (stderr).
 * - The egress proxy's audit log names hosts and ports, never a URL path.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { systemProcess } from "@mainahq/core";
import type { McpRuntime } from "@mainahq/mcp";
import { serveFakeGitHub } from "../../deploy/__tests__/fake-github-server";
import { type EgressEvent, startEgressProxy } from "../edge/egress";
import {
	API,
	APP_JWT,
	fakeGitHub,
	INSTALLATION_ID,
} from "../github/__tests__/fake-github";
import { type AppCredentials, restGitHubApi } from "../github/app";
import { systemWorkspaces, type Workspaces } from "../github/checkout";
import {
	createJobRunner,
	type JobError,
	type JobReport,
	type JobRequest,
} from "../github/jobs";
import {
	jobEnvironment,
	jobLogEvent,
	runWithoutRetention,
} from "../github/retention";

const REMOTE = resolve(import.meta.dir, "../..");
const REPO_ROOT = resolve(REMOTE, "../..");
const JOB = join(REMOTE, "src", "github", "main.ts");

/** A line of code no log or leftover file may ever contain. */
const CANARY = `retention_canary_${crypto.randomUUID().replaceAll("-", "")}`;
/** A file name no log may ever contain. */
const FILE = "src/billing-secret-module.ts";
const CODE = `export const ${CANARY} = "do not keep";\n`;

const REPO = { owner: "acme", name: "widgets" } as const;
const TARGET = {
	installationId: INSTALLATION_ID,
	repository: REPO,
	pullNumber: 7,
} as const;

// ── Fixture: a repository whose pull request carries the canary ────────────

type Fixture = Readonly<{
	dir: string;
	origin: string;
	head: string;
	base: string;
}>;

function git(cwd: string, ...args: string[]): string {
	const out = Bun.spawnSync(["git", ...args], {
		cwd,
		env: {
			PATH: process.env.PATH ?? "",
			HOME: cwd,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_AUTHOR_NAME: "retention",
			GIT_AUTHOR_EMAIL: "retention@example.com",
			GIT_COMMITTER_NAME: "retention",
			GIT_COMMITTER_EMAIL: "retention@example.com",
		},
	});
	if (out.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);
	}
	return out.stdout.toString().trim();
}

function makeFixture(): Fixture {
	const dir = mkdtempSync(join(tmpdir(), "maina-356-"));
	const origin = join(dir, "origin");
	mkdirSync(join(origin, "src"), { recursive: true });
	git(origin, "init", "-q", "-b", "main");
	writeFileSync(join(origin, "src", "index.ts"), "export const v = 1;\n");
	git(origin, "add", ".");
	git(origin, "commit", "-q", "-m", "base");
	const base = git(origin, "rev-parse", "HEAD");
	writeFileSync(join(origin, FILE), CODE);
	git(origin, "add", ".");
	git(origin, "commit", "-q", "-m", "head");
	const head = git(origin, "rev-parse", "HEAD");
	git(origin, "reset", "-q", "--hard", base);
	git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
	return { dir, origin, head, base };
}

const pullFor = (fx: Fixture, cloneUrl = `file://${fx.origin}`) => ({
	number: 7,
	head: fx.head,
	base: fx.base,
	cloneUrl,
	files: [{ filename: FILE, status: "added" }],
});

/** Every file under `dir` (skipping `skip`), with its path relative to `dir`. */
function filesUnder(dir: string, skip: readonly string[] = []): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { recursive: true, encoding: "utf8" })
		.map((rel) => join(dir, rel))
		.filter((path) => !skip.some((s) => path === s || path.startsWith(`${s}/`)))
		.filter((path) => statSync(path).isFile());
}

/** The files under `dir` that hold the canary. */
function holdingCode(dir: string, skip: readonly string[] = []): string[] {
	return filesUnder(dir, skip)
		.filter((path) => readFileSync(path).includes(CANARY))
		.map((path) => relative(dir, path));
}

/** What a log must never contain for a job run under `paths`. */
function expectNoCodeOrJobPaths(log: string, paths: readonly string[]): void {
	expect(log).not.toContain(CANARY);
	expect(log).not.toContain(FILE);
	expect(log).not.toContain("billing-secret-module");
	expect(log).not.toContain("maina-job-");
	for (const path of paths) expect(log).not.toContain(path);
}

/** A job's log line: no code, none of `paths`, no absolute path at all. */
function expectNoCodeOrPaths(log: string, paths: readonly string[]): void {
	expectNoCodeOrJobPaths(log, paths);
	// No absolute path of any kind, POSIX or Windows.
	expect(log).not.toMatch(/(^|[\s"'=:(])\/[\w.-]+\//);
	expect(log).not.toMatch(/[A-Za-z]:\\/);
}

// ── The job log ─────────────────────────────────────────────────────────────

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const WORKSPACE = "/var/tmp/maina-job-XyZ123";
const leaky = `${WORKSPACE}/${FILE}: ${CODE}`;

const REPORT: JobReport = {
	kind: "verify",
	result: {
		passed: false,
		findings: [{ tool: "biome", file: FILE, line: 1, message: CODE }],
	} as never,
	repository: "acme/widgets",
	pullNumber: 7,
	head: HEAD,
	base: BASE,
	workspace: { path: WORKSPACE, removed: true },
};

const ERRORS: readonly JobError[] = [
	{
		kind: "invalid_request",
		message: `spec path ${leaky} leaves the workspace`,
	},
	{ kind: "github", status: 404, message: `Not Found: ${leaky}` },
	{ kind: "workspace", message: `git fetch: fatal: ${leaky}` },
	{
		kind: "cleanup_failed",
		path: WORKSPACE,
		message: `cannot remove ${leaky}`,
	},
	{ kind: "capability", error: { kind: "failed", message: leaky } },
	{
		kind: "capability",
		error: { kind: "not_found", path: FILE, message: leaky },
	},
];

const VERIFY: JobRequest = { kind: "verify", ...TARGET };

describe("jobLogEvent: the one line a job logs", () => {
	test("says which job ran on which pull request, how it ended and how long it took", () => {
		expect(jobLogEvent(VERIFY, { ok: true, value: REPORT }, 1234)).toEqual({
			event: "job",
			kind: "verify",
			repository: "acme/widgets",
			pullNumber: 7,
			head: HEAD,
			outcome: "ok",
			durationMs: 1234,
		});
	});

	test("a successful job's line carries no code and no path", () => {
		const line = JSON.stringify(
			jobLogEvent(VERIFY, { ok: true, value: REPORT }, 5),
		);
		expectNoCodeOrPaths(line, [WORKSPACE]);
	});

	for (const error of ERRORS) {
		test(`a ${error.kind} failure is logged by kind, without its message or paths`, () => {
			const event = jobLogEvent(VERIFY, { ok: false, error }, 5);
			expect(event.outcome).toBe(error.kind);
			expect(event).not.toHaveProperty("head");
			expectNoCodeOrPaths(JSON.stringify(event), [WORKSPACE]);
		});
	}

	test("keeps the GitHub status and the capability's error kind, which carry no data", () => {
		expect(
			jobLogEvent(
				VERIFY,
				{ ok: false, error: { kind: "github", status: 404, message: leaky } },
				5,
			),
		).toMatchObject({ outcome: "github", status: 404 });
		expect(
			jobLogEvent(
				VERIFY,
				{
					ok: false,
					error: {
						kind: "capability",
						error: { kind: "not_found", path: FILE, message: leaky },
					},
				},
				5,
			),
		).toMatchObject({ outcome: "capability", reason: "not_found" });
	});

	test("a repository name that could read as a path is not logged as given", () => {
		const event = jobLogEvent(
			{ ...VERIFY, repository: { owner: "..", name: "etc" } },
			{ ok: false, error: { kind: "invalid_request", message: leaky } },
			5,
		);
		expect(event.repository).toBe("(invalid)");
	});
});

// ── The job environment ─────────────────────────────────────────────────────

describe("jobEnvironment: where a job's tools may write", () => {
	const scratch = "/scratch/job-1";
	const env = jobEnvironment(
		{
			PATH: "/usr/bin",
			HOME: "/home/bun",
			TMPDIR: "/tmp",
			XDG_CACHE_HOME: "/home/bun/.cache",
			OPENROUTER_API_KEY: "sk-test",
		},
		scratch,
	);

	test("puts the temp directory, $HOME and every XDG directory inside the scratch directory", () => {
		for (const name of [
			"TMPDIR",
			"TMP",
			"TEMP",
			"HOME",
			"USERPROFILE",
			"XDG_CACHE_HOME",
			"XDG_CONFIG_HOME",
			"XDG_DATA_HOME",
			"XDG_STATE_HOME",
		]) {
			const value = env[name] ?? "";
			expect(value === scratch || value.startsWith(`${scratch}/`)).toBe(true);
		}
	});

	test("turns every telemetry channel off for the job's tools", () => {
		expect(env.DO_NOT_TRACK).toBe("1");
		expect(env.MAINA_TELEMETRY).toBe("0");
	});

	test("keeps the rest of the environment", () => {
		expect(env.PATH).toBe("/usr/bin");
		expect(env.OPENROUTER_API_KEY).toBe("sk-test");
	});
});

// ── Nothing persists after a job (in process) ──────────────────────────────

const credentials: AppCredentials = {
	appJwt: async () => ({ ok: true, value: APP_JWT }),
};

type Behaviour = "succeed" | "fail" | "throw";

/**
 * A runtime whose `verify` behaves like a real tool run: it reads the PR's
 * code and copies it into the job's `.maina`, its temp directory, `$HOME`
 * and its XDG cache, then succeeds, fails or throws.
 */
function toolLikeRuntime(
	root: string,
	env: Readonly<Record<string, string | undefined>>,
	behaviour: Behaviour,
): McpRuntime {
	const unused = () =>
		Promise.resolve({
			ok: false as const,
			error: { kind: "failed" as const, message: "unused" },
		});
	return {
		resolveRoot: async () => ({ ok: true, value: root }),
		verify: async () => {
			const code = readFileSync(join(root, FILE), "utf8");
			for (const dir of [
				join(root, ".maina", "cache"),
				env.TMPDIR ?? "",
				join(env.HOME ?? "", ".tool"),
				join(env.XDG_CACHE_HOME ?? "", "tool"),
			]) {
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, "copy.txt"), code);
			}
			if (behaviour === "throw") throw new Error(`tool crashed on ${code}`);
			if (behaviour === "fail") {
				return {
					ok: false,
					error: { kind: "failed", message: `${root}/${FILE}: ${code}` },
				};
			}
			return {
				ok: true,
				value: {
					passed: false,
					findings: [{ tool: "tool", file: FILE, line: 1, message: code }],
				} as never,
			};
		},
		impact: unused,
		review: unused,
		specCheck: unused,
		decide: unused,
		context: unused,
		receipts: unused,
		status: unused,
		wiki: { ask: unused, structure: unused, contents: unused },
	};
}

describe("runWithoutRetention: nothing of the code outlives the job", () => {
	let fx: Fixture;
	let tmpRoot: string;

	beforeAll(() => {
		fx = makeFixture();
	});

	afterAll(() => {
		rmSync(fx.dir, { recursive: true, force: true });
	});

	async function run(
		behaviour: Behaviour,
		options: Readonly<{ cloneUrl?: string; scratch?: Workspaces }> = {},
	) {
		tmpRoot = mkdtempSync(join(fx.dir, "tmp-"));
		const gh = fakeGitHub({ pulls: [pullFor(fx, options.cloneUrl)] });
		const env = { PATH: process.env.PATH ?? "", HOME: join(fx.dir, "home") };
		const scratch =
			options.scratch ??
			systemWorkspaces({ process: systemProcess, env, tmpRoot });
		let clock = 1000;
		const outcome = await runWithoutRetention(
			{
				scratch,
				env,
				now: () => {
					clock += 250;
					return clock;
				},
				runnerFor: ({ scratch: dir, env: jobEnv }) => {
					return createJobRunner({
						credentials,
						api: restGitHubApi({ fetch: gh.fetch, baseUrl: API }),
						workspaces: systemWorkspaces({
							process: systemProcess,
							env: jobEnv,
							tmpRoot: dir,
						}),
						runtimeFor: (root) => toolLikeRuntime(root, jobEnv, behaviour),
					});
				},
			},
			VERIFY,
		);
		return { ...outcome, gh };
	}

	const leftovers = () =>
		holdingCode(fx.dir, [fx.origin]).concat(
			readdirSync(tmpRoot).map((name) => `tmp/${name}`),
		);

	test("a job that succeeds leaves no checkout, temp file, cache or home file behind", async () => {
		const { result, log } = await run("succeed");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// The report goes back to the caller, whose PR it describes ...
		expect(JSON.stringify(result.value)).toContain(CANARY);
		expect(result.value.workspace.removed).toBe(true);
		// ... and nothing of it stays on the machine.
		expect(leftovers()).toEqual([]);
		expect(log).toMatchObject({ outcome: "ok", durationMs: 250 });
		expectNoCodeOrPaths(JSON.stringify(log), [fx.dir, tmpRoot]);
	});

	for (const behaviour of ["fail", "throw"] as const) {
		test(`a job whose capability ${behaviour}s leaves nothing behind either`, async () => {
			const { result, log } = await run(behaviour);
			expect(result.ok).toBe(false);
			expect(leftovers()).toEqual([]);
			expect(log.outcome).toBe(result.ok ? "ok" : result.error.kind);
			expectNoCodeOrPaths(JSON.stringify(log), [fx.dir, tmpRoot]);
		});
	}

	test("a job whose checkout fails leaves nothing behind", async () => {
		const missing = join(fx.dir, "no-such-origin");
		const { result, log } = await run("succeed", {
			cloneUrl: `file://${missing}`,
		});
		expect(!result.ok && result.error.kind).toBe("workspace");
		expect(leftovers()).toEqual([]);
		expectNoCodeOrPaths(JSON.stringify(log), [fx.dir, tmpRoot, missing]);
	});

	test("the installation token is revoked however the job ends", async () => {
		for (const behaviour of ["succeed", "fail", "throw"] as const) {
			const { gh } = await run(behaviour);
			expect(gh.liveTokens()).toEqual([]);
		}
	});

	test("a scratch directory that survives removal fails the job, and the log names no path", async () => {
		const real = systemWorkspaces({
			process: systemProcess,
			env: { PATH: process.env.PATH ?? "" },
			tmpRoot: mkdtempSync(join(fx.dir, "stuck-")),
		});
		let made = "";
		const stuck: Workspaces = {
			...real,
			create: async () => {
				const dir = await real.create();
				if (dir.ok) made = dir.value;
				return dir;
			},
			remove: async () => ({ ok: true, value: undefined }),
		};
		const { result, log } = await run("succeed", { scratch: stuck });
		expect(!result.ok && result.error).toEqual({
			kind: "cleanup_failed",
			path: made,
			message: expect.any(String),
		});
		expect(log.outcome).toBe("cleanup_failed");
		expectNoCodeOrPaths(JSON.stringify(log), [fx.dir, made]);
		rmSync(made, { recursive: true, force: true });
	});
});

// ── Nothing persists after a job (the job process) ─────────────────────────

type ProcessRun = Readonly<{
	exitCode: number;
	stdout: string;
	stderr: string;
	tmp: string;
	home: string;
}>;

async function runJobProcess(
	fx: Fixture,
	name: string,
	cloneUrl?: string,
): Promise<ProcessRun> {
	const tmp = join(fx.dir, `${name}-tmp`);
	const home = join(fx.dir, `${name}-home`);
	mkdirSync(tmp, { recursive: true });
	mkdirSync(join(home, ".maina"), { recursive: true });
	const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const gh = serveFakeGitHub({
		port: 0,
		hostname: "127.0.0.1",
		pull: pullFor(fx, cloneUrl),
		appPublicKey: keys.publicKey
			.export({ type: "spki", format: "pem" })
			.toString(),
	});
	try {
		const proc = Bun.spawn(
			[
				"bun",
				JOB,
				"impact",
				"--repo",
				"acme/widgets",
				"--pr",
				"7",
				"--installation",
				String(INSTALLATION_ID),
			],
			{
				cwd: REPO_ROOT,
				env: {
					PATH: process.env.PATH ?? "",
					HOME: home,
					TMPDIR: tmp,
					MAINA_JOBS_TMPDIR: tmp,
					MAINA_GITHUB_APP_ID: "1",
					MAINA_GITHUB_APP_PRIVATE_KEY: keys.privateKey
						.export({ type: "pkcs8", format: "pem" })
						.toString(),
					MAINA_GITHUB_API_URL: gh.api,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		return { exitCode, stdout, stderr, tmp, home };
	} finally {
		gh.stop();
	}
}

describe("the job process keeps no code and logs none", () => {
	let fx: Fixture;
	let ok: ProcessRun;
	let failed: ProcessRun;
	const missing = () => join(fx.dir, "gone-origin");

	beforeAll(async () => {
		fx = makeFixture();
		[ok, failed] = await Promise.all([
			runJobProcess(fx, "ok"),
			runJobProcess(fx, "failed", `file://${missing()}`),
		]);
	}, 60_000);

	afterAll(() => {
		rmSync(fx.dir, { recursive: true, force: true });
	});

	test("an impact job indexes the PR's code and reports on it", () => {
		expect({ exitCode: ok.exitCode, stderr: ok.stderr }).toEqual({
			exitCode: 0,
			stderr: expect.any(String),
		});
		const report = JSON.parse(ok.stdout) as {
			kind: string;
			workspace: { removed: boolean };
		};
		expect(report.kind).toBe("impact");
		expect(report.workspace.removed).toBe(true);
	});

	test("no file of the PR's code, its index or a tool's temp file survives the job", () => {
		expect(readdirSync(ok.tmp)).toEqual([]);
		expect(readdirSync(failed.tmp)).toEqual([]);
		expect(holdingCode(fx.dir, [fx.origin])).toEqual([]);
	});

	test("the operator's home gets none of the PR's code and no maina state", () => {
		for (const run of [ok, failed]) {
			// (Bun's own transpiler cache of the maina sources may land here.)
			expect(holdingCode(run.home)).toEqual([]);
			expect(filesUnder(join(run.home, ".maina"))).toEqual([]);
		}
	});

	test("stderr ends with the job's log line, which names no code and no path", () => {
		for (const run of [ok, failed]) {
			const last = run.stderr.trim().split("\n").at(-1) ?? "";
			expect(JSON.parse(last)).toMatchObject({
				event: "job",
				kind: "impact",
				repository: "acme/widgets",
				pullNumber: 7,
			});
			expectNoCodeOrPaths(last, [fx.dir, run.tmp, missing()]);
			// The startup line names the operator's policy and model
			// locations (configuration); nothing on stderr names the job's.
			expectNoCodeOrJobPaths(run.stderr, [run.tmp, missing(), fx.origin]);
		}
		expect(JSON.parse(ok.stderr.trim().split("\n").at(-1) ?? "")).toMatchObject(
			{ outcome: "ok", head: fx.head },
		);
	});

	test("a failed job exits 1 and gives its detailed error on stdout, not in the log", () => {
		expect(failed.exitCode).toBe(1);
		const parsed = JSON.parse(failed.stdout) as { error: { kind: string } };
		expect(parsed.error.kind).toBe("workspace");
		expect(
			JSON.parse(failed.stderr.trim().split("\n").at(-1) ?? ""),
		).toMatchObject({ outcome: "workspace" });
	});
});

// ── The egress audit log ────────────────────────────────────────────────────

async function send(port: number, head: string): Promise<void> {
	await new Promise<void>((done) => {
		const socket = connect({ host: "127.0.0.1", port }, () => {
			socket.write(head);
		});
		socket.on("data", () => socket.end());
		socket.on("close", () => done());
		socket.on("error", () => done());
	});
}

describe("the egress proxy's audit log", () => {
	test("names the host and port of each attempt, never a URL path or query", async () => {
		const events: EgressEvent[] = [];
		const proxy = await startEgressProxy({
			port: 0,
			hostname: "127.0.0.1",
			allow: [],
			log: (event) => events.push(event),
		});
		try {
			await send(
				proxy.port,
				`GET http://example.com/${FILE}?code=${CANARY} HTTP/1.1\r\nHost: example.com\r\n\r\n`,
			);
			await send(
				proxy.port,
				"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n",
			);
		} finally {
			await proxy.stop();
		}
		expect(events.length).toBe(2);
		const log = events.map((e) => JSON.stringify(e)).join("\n");
		expect(log).not.toContain(CANARY);
		expect(log).not.toContain(FILE);
		for (const event of events) {
			expect(Object.keys(event).sort()).toEqual([
				"allowed",
				"event",
				"host",
				"method",
				"port",
			]);
		}
	});
});
