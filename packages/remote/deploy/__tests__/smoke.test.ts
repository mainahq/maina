/**
 * Self-host smoke test (FR-REM-4): the self-hostable image runs a PR job
 * with the operator's policy file and a model artifact in place, and the
 * install makes no outbound network call except to GitHub.
 *
 * Three layers, cheapest first:
 *
 * 1. The deployment manifests (compose, helm values, Dockerfile) wire what
 *    the claim rests on: the maina containers sit on a network with no
 *    route out, the only bridge is the egress proxy, whose allow-list is
 *    GitHub, and the policy and model are mounted read-only where the
 *    image reads them.
 * 2. The image's job process, run as the container runs it (same entry
 *    file, `$HOME/.maina` layout, proxy environment), against a fake
 *    GitHub, with a network spy preloaded: every outbound attempt is
 *    recorded and anything but the GitHub stand-in is refused. Always runs.
 * 3. With `MAINA_DOCKER_SMOKE=1` and a Docker daemon: builds the image and
 *    runs the compose deployment for real on its egress-blocked network,
 *    runs one job, probes that nothing else gets out, serves the MCP
 *    endpoint through the ingress, and renders the helm chart.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GITHUB_HOSTS, parseAllowlist } from "../../src/edge/egress";
import { serveFakeGitHub } from "./fake-github-server";

const REMOTE = resolve(import.meta.dir, "../..");
const REPO_ROOT = resolve(REMOTE, "../..");
const COMPOSE_DIR = join(REMOTE, "deploy", "compose");
const COMPOSE_FILE = join(COMPOSE_DIR, "docker-compose.yml");
const SMOKE_COMPOSE = join(import.meta.dir, "smoke.compose.yml");
const CHART = join(REMOTE, "deploy", "helm", "maina-remote");
const SPY = join(import.meta.dir, "network-spy.ts");
const JOB = join(REMOTE, "src", "github", "main.ts");

/** Where the image keeps the operator's maina state: `$HOME/.maina`. */
const IMAGE_MAINA = "/home/bun/.maina";
const EGRESS_PROXY = "http://egress:3128";

const DECIDE_REQUEST = {
	type: "review.reviewer_kind",
	state: { trusted: {}, untrusted: { reviewer: "dependabot[bot]" } },
	questions: [{ kind: "choice", id: "reviewer", options: ["bot", "human"] }],
};

/**
 * The operator's policy: routes the decision to the local model, which is
 * present as an artifact but has no runtime in this release, so the
 * catalog's heuristic answers and nothing is downloaded.
 */
const POLICY = {
	version: 1,
	protected_branches: ["release"],
	decisions: { "review.reviewer_kind": { backend: "system1" } },
	telemetry: { crash_reports: false, usage: false, outcome_sharing: false },
};

// ── Fixture: a repository with a PR, an operator home, an App key ──────────

type Fixture = Readonly<{
	dir: string;
	home: string;
	origin: string;
	head: string;
	base: string;
	privateKey: string;
	publicKey: string;
}>;

function git(cwd: string, ...args: string[]): string {
	const out = Bun.spawnSync(["git", ...args], {
		cwd,
		env: {
			PATH: process.env.PATH ?? "",
			HOME: cwd,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_AUTHOR_NAME: "smoke",
			GIT_AUTHOR_EMAIL: "smoke@example.com",
			GIT_COMMITTER_NAME: "smoke",
			GIT_COMMITTER_EMAIL: "smoke@example.com",
		},
	});
	if (out.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);
	}
	return out.stdout.toString().trim();
}

function makeFixture(policy: unknown = POLICY): Fixture {
	const dir = mkdtempSync(join(tmpdir(), "maina-355-"));
	// Docker runs the image as uid 1000, which must write the spy log.
	chmodSync(dir, 0o755);
	const home = join(dir, "home");
	mkdirSync(join(home, ".maina", "models"), { recursive: true });
	writeFileSync(join(home, ".maina", "policy.json"), JSON.stringify(policy));
	writeFileSync(
		join(home, ".maina", "models", "system1.onnx"),
		"model artifact stub",
	);

	const origin = join(dir, "origin");
	mkdirSync(origin);
	git(origin, "init", "-q", "-b", "main");
	writeFileSync(join(origin, "app.ts"), "export const v = 1;\n");
	git(origin, "add", "app.ts");
	git(origin, "commit", "-q", "-m", "base");
	const base = git(origin, "rev-parse", "HEAD");
	writeFileSync(join(origin, "app.ts"), "export const v = 2;\n");
	git(origin, "commit", "-q", "-am", "head");
	const head = git(origin, "rev-parse", "HEAD");
	git(origin, "reset", "-q", "--hard", base);
	git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");

	const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
	return {
		dir,
		home,
		origin,
		head,
		base,
		privateKey: keys.privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString(),
		publicKey: keys.publicKey
			.export({ type: "spki", format: "pem" })
			.toString(),
	};
}

const pullFor = (fx: Fixture, cloneUrl: string) => ({
	number: 7,
	head: fx.head,
	base: fx.base,
	cloneUrl,
	files: [{ filename: "app.ts", status: "modified" }],
});

const jobArgs = [
	"decide",
	"--repo",
	"acme/widgets",
	"--pr",
	"7",
	"--installation",
	"4242",
	"--request",
	JSON.stringify(DECIDE_REQUEST),
];

type Attempt = Readonly<{
	api: string;
	host: string;
	port: number | null;
	allowed: boolean;
}>;

const readAttempts = (file: string): Attempt[] =>
	existsSync(file)
		? readFileSync(file, "utf8")
				.split("\n")
				.filter((l) => l.trim() !== "")
				.map((l) => JSON.parse(l) as Attempt)
		: [];

// ── 1. Manifests ────────────────────────────────────────────────────────────

type ComposeService = {
	image?: string;
	entrypoint?: string[];
	networks?: string[] | Record<string, unknown>;
	ports?: string[];
	environment?: Record<string, string>;
	volumes?: string[];
	read_only?: boolean;
	cap_drop?: string[];
	security_opt?: string[];
	tmpfs?: string[];
};

type Compose = {
	services: Record<string, ComposeService>;
	networks: Record<string, { internal?: boolean } | null>;
};

const compose = (): Compose =>
	Bun.YAML.parse(readFileSync(COMPOSE_FILE, "utf8")) as Compose;

const networksOf = (s: ComposeService): string[] =>
	(Array.isArray(s.networks) ? s.networks : Object.keys(s.networks ?? {}))
		.slice()
		.sort();

/** The default of a `${VAR:-default}` interpolation, else the value. */
const interpolationDefault = (value: string | undefined): string | undefined =>
	value?.replace(/^\$\{[A-Z_]+:-(.*)\}$/, "$1");

const MAINA_SERVICES = ["remote", "job"] as const;

describe("compose deployment", () => {
	test("is the MCP service, the PR job, and the two edge forwarders", () => {
		expect(Object.keys(compose().services).sort()).toEqual([
			"egress",
			"ingress",
			"job",
			"remote",
		]);
	});

	test("the maina containers are on an internal network only: no route out", () => {
		const c = compose();
		expect(c.networks.internal?.internal).toBe(true);
		for (const name of MAINA_SERVICES) {
			const service = c.services[name];
			expect(service).toBeDefined();
			if (service === undefined) continue;
			expect(networksOf(service)).toEqual(["internal"]);
			expect(service.ports).toBeUndefined();
		}
	});

	test("only the egress and ingress forwarders bridge to the outside", () => {
		const c = compose();
		expect(c.networks.edge?.internal ?? false).toBe(false);
		const bridged = Object.entries(c.services)
			.filter(([, s]) => networksOf(s).includes("edge"))
			.map(([name]) => name)
			.sort();
		expect(bridged).toEqual(["egress", "ingress"]);
		// And only the ingress takes inbound traffic.
		const published = Object.entries(c.services)
			.filter(([, s]) => s.ports !== undefined)
			.map(([name]) => name);
		expect(published).toEqual(["ingress"]);
	});

	test("the egress allow-list defaults to GitHub and nothing else", () => {
		const egress = compose().services.egress;
		const raw = interpolationDefault(egress?.environment?.MAINA_EGRESS_ALLOW);
		const allow = parseAllowlist(raw);
		expect(allow).toEqual({
			ok: true,
			value: GITHUB_HOSTS.map((host) => ({ host, port: 443 })),
		});
	});

	test("the maina containers reach out only through the egress proxy", () => {
		const c = compose();
		for (const name of MAINA_SERVICES) {
			const env = c.services[name]?.environment ?? {};
			for (const key of [
				"HTTPS_PROXY",
				"https_proxy",
				"HTTP_PROXY",
				"http_proxy",
			]) {
				expect(env[key]).toBe(EGRESS_PROXY);
			}
		}
	});

	test("the policy file and the model artifacts are mounted read-only where the image reads them", () => {
		const c = compose();
		for (const name of MAINA_SERVICES) {
			const volumes = c.services[name]?.volumes ?? [];
			/** The default source mounted read-only at `target`. */
			const source = (target: string): string | undefined => {
				const suffix = `:${target}:ro`;
				const volume = volumes.find((v) => v.endsWith(suffix));
				return interpolationDefault(volume?.slice(0, -suffix.length));
			};
			expect(source(`${IMAGE_MAINA}/policy.json`)).toBe("./policy.json");
			expect(source(`${IMAGE_MAINA}/models`)).toBe("./models");
		}
		// The defaults it points at ship with the deployment.
		const example = JSON.parse(
			readFileSync(join(COMPOSE_DIR, "policy.json"), "utf8"),
		) as { telemetry?: Record<string, boolean> };
		expect(Object.values(example.telemetry ?? {})).not.toContain(true);
		expect(existsSync(join(COMPOSE_DIR, "models"))).toBe(true);
	});

	test("every container runs read-only, with no capabilities and no privilege gain", () => {
		for (const [name, s] of Object.entries(compose().services)) {
			expect({ name, read_only: s.read_only }).toEqual({
				name,
				read_only: true,
			});
			expect(s.cap_drop).toEqual(["ALL"]);
			expect(s.security_opt).toContain("no-new-privileges:true");
		}
	});

	test("each service runs an entry file the image ships", () => {
		for (const [name, s] of Object.entries(compose().services)) {
			const file = s.entrypoint?.find((a) => a.endsWith(".ts"));
			expect({ name, file }).toEqual({ name, file: expect.any(String) });
			if (file === undefined) continue;
			expect(existsSync(join(REPO_ROOT, file))).toBe(true);
			expect(file.startsWith("packages/remote/src/")).toBe(true);
		}
	});
});

describe("helm chart", () => {
	type Values = {
		image: { repository: string };
		home: string;
		egress: { allowedHosts: string[]; port: number };
		networkPolicy: { enabled: boolean };
	};
	const values = (): Values =>
		Bun.YAML.parse(readFileSync(join(CHART, "values.yaml"), "utf8")) as Values;

	test("is a v2 chart named maina-remote", () => {
		const chart = Bun.YAML.parse(
			readFileSync(join(CHART, "Chart.yaml"), "utf8"),
		) as { apiVersion: string; name: string };
		expect(chart.apiVersion).toBe("v2");
		expect(chart.name).toBe("maina-remote");
	});

	test("egress defaults to GitHub only, enforced by a network policy", () => {
		const v = values();
		expect(v.egress.allowedHosts).toEqual([...GITHUB_HOSTS]);
		expect(v.networkPolicy.enabled).toBe(true);
		expect(v.home).toBe("/home/bun");
		const policy = readFileSync(
			join(CHART, "templates", "networkpolicy.yaml"),
			"utf8",
		);
		expect(policy).toContain("kind: NetworkPolicy");
		expect(policy).toContain("- Egress");
	});

	test("mounts the policy and the model where the image reads them", () => {
		const deployment = readFileSync(
			join(CHART, "templates", "remote.yaml"),
			"utf8",
		);
		expect(deployment).toContain("/.maina/policy.json");
		expect(deployment).toContain("/.maina/models");
		expect(deployment).toContain("readOnly: true");
	});
});

describe("image", () => {
	const dockerfile = () => readFileSync(join(REMOTE, "Dockerfile"), "utf8");

	test("keeps the operator's state under $HOME/.maina, owned by the unprivileged user", () => {
		const text = dockerfile();
		expect(text).toContain("HOME=/home/bun");
		expect(text).toContain(`${IMAGE_MAINA}/models`);
		expect(text).toMatch(/^USER bun$/m);
	});

	test("does not ship the deployment files or tests", () => {
		const ignore = readFileSync(
			join(REMOTE, "Dockerfile.dockerignore"),
			"utf8",
		);
		expect(ignore).toContain("**/__tests__");
		expect(ignore).toContain("packages/remote/deploy");
	});
});

// ── 2. The job process with a network spy ──────────────────────────────────

/** A proxy that records every connection and answers none of them. */
async function recordingProxy(): Promise<{
	url: string;
	hits: string[];
	stop: () => Promise<void>;
}> {
	const hits: string[] = [];
	const server: Server = createServer((socket) => {
		socket.once("data", (chunk) => {
			hits.push(chunk.toString().split("\r\n")[0] ?? "");
			socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const address = server.address();
	const port =
		typeof address === "object" && address !== null ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}`,
		hits,
		stop: () => new Promise<void>((r) => server.close(() => r())),
	};
}

type JobRun = Readonly<{
	exitCode: number;
	stdout: string;
	stderr: string;
	attempts: Attempt[];
	proxied: string[];
	github: Readonly<{
		requests: readonly Readonly<{ method: string; path: string }>[];
		liveTokens: () => readonly string[];
	}>;
}>;

async function runJobProcess(fx: Fixture): Promise<JobRun> {
	const tmp = join(fx.dir, "tmp");
	mkdirSync(tmp, { recursive: true });
	const spyLog = join(fx.dir, `network-${Date.now()}.jsonl`);
	const gh = serveFakeGitHub({
		port: 0,
		hostname: "127.0.0.1",
		pull: pullFor(fx, `file://${fx.origin}`),
		appPublicKey: fx.publicKey,
	});
	const proxy = await recordingProxy();
	try {
		const proc = Bun.spawn(["bun", "--preload", SPY, JOB, ...jobArgs], {
			cwd: REPO_ROOT,
			env: {
				PATH: process.env.PATH ?? "",
				HOME: fx.home,
				MAINA_JOBS_TMPDIR: tmp,
				MAINA_GITHUB_APP_ID: "1",
				MAINA_GITHUB_APP_PRIVATE_KEY: fx.privateKey,
				MAINA_GITHUB_API_URL: gh.api,
				// As in the container: anything that is not GitHub goes to
				// the proxy, which here records it and lets nothing through.
				HTTPS_PROXY: proxy.url,
				https_proxy: proxy.url,
				HTTP_PROXY: proxy.url,
				http_proxy: proxy.url,
				ALL_PROXY: proxy.url,
				NO_PROXY: "localhost",
				no_proxy: "localhost",
				MAINA_NETWORK_SPY_LOG: spyLog,
				MAINA_NETWORK_SPY_ALLOW: `localhost:${gh.port}`,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			proc.exited,
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		return {
			exitCode,
			stdout,
			stderr,
			attempts: readAttempts(spyLog),
			proxied: proxy.hits,
			github: gh.github,
		};
	} finally {
		gh.stop();
		await proxy.stop();
	}
}

describe("smoke: the image's job process with a policy file and a model artifact", () => {
	let fx: Fixture;
	let run: JobRun;

	beforeAll(async () => {
		fx = makeFixture();
		run = await runJobProcess(fx);
	}, 60_000);

	afterAll(() => {
		rmSync(fx.dir, { recursive: true, force: true });
	});

	test("runs the job to completion and answers the decision", () => {
		expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({
			exitCode: 0,
			stderr: expect.any(String),
		});
		const report = JSON.parse(run.stdout) as {
			kind: string;
			repository: string;
			head: string;
			base: string;
			result: { answer: string; backend: { id: string } }[];
			workspace: { removed: boolean };
		};
		expect(report.kind).toBe("decide");
		expect(report.repository).toBe("acme/widgets");
		expect(report.head).toBe(fx.head);
		expect(report.base).toBe(fx.base);
		expect(report.result[0]?.answer).toBe("bot");
		// The policy routes this decision to the local model; the artifact
		// is there but no model runtime ships yet, so the heuristic answered
		// (and nothing was fetched to fill the gap).
		expect(report.result[0]?.backend.id).toBe("heuristic");
		expect(report.workspace.removed).toBe(true);
	});

	test("reads the operator's policy file and finds the model artifact", () => {
		expect(run.stderr).toContain(
			`policy ${join(fx.home, ".maina", "policy.json")} (valid)`,
		);
		expect(run.stderr).toContain(
			`model ${join(fx.home, ".maina", "models")} (1 file: system1.onnx)`,
		);
	});

	test("talks to GitHub, and only to GitHub", () => {
		// The spy saw the job's GitHub calls (so it was watching) ...
		expect(run.attempts.length).toBeGreaterThanOrEqual(5);
		// ... and nothing else: every attempt went to the GitHub stand-in.
		const elsewhere = run.attempts.filter((a) => !a.allowed);
		expect(elsewhere).toEqual([]);
		expect(new Set(run.attempts.map((a) => `${a.host}:${a.port}`)).size).toBe(
			1,
		);
		// No child process (git, tools) tried the proxy either.
		expect(run.proxied).toEqual([]);
	});

	test("asks GitHub for a token, the PR, its files and merge base, then revokes the token", () => {
		// Distinct endpoints in first-call order (the files list is paged).
		const endpoints = [
			...new Set(
				run.github.requests.map((r) => `${r.method} ${r.path.split("?")[0]}`),
			),
		];
		expect(endpoints).toEqual([
			"POST /app/installations/4242/access_tokens",
			"GET /repos/acme/widgets/pulls/7",
			"GET /repos/acme/widgets/pulls/7/files",
			`GET /repos/acme/widgets/compare/${fx.base}...${fx.head}`,
			"DELETE /installation/token",
		]);
		expect(run.github.liveTokens()).toEqual([]);
	});
});

describe("smoke: a policy that would phone home stops the job before any network", () => {
	let fx: Fixture;
	let run: JobRun;

	beforeAll(async () => {
		fx = makeFixture({ telemetry: { usage: true } });
		run = await runJobProcess(fx);
	}, 60_000);

	afterAll(() => {
		rmSync(fx.dir, { recursive: true, force: true });
	});

	test("exits 1 naming the telemetry opt-in", () => {
		expect(run.exitCode).toBe(1);
		expect(run.stderr).toContain("telemetry.usage");
		expect(run.stdout).toBe("");
	});

	test("never contacts anything, GitHub included", () => {
		expect(run.attempts).toEqual([]);
		expect(run.proxied).toEqual([]);
		expect(run.github.requests).toEqual([]);
	});
});

// ── 3. The real image on the egress-blocked compose network ────────────────

const DOCKER = process.env.MAINA_DOCKER_SMOKE === "1";
const HELM_IMAGE = "alpine/helm:3.16.4";

type Exec = Readonly<{ exitCode: number; stdout: string; stderr: string }>;

async function exec(
	cmd: readonly string[],
	env: Readonly<Record<string, string>> = {},
): Promise<Exec> {
	const proc = Bun.spawn([...cmd], {
		cwd: COMPOSE_DIR,
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const address = server.address();
	const port =
		typeof address === "object" && address !== null ? address.port : 0;
	await new Promise<void>((r) => server.close(() => r()));
	return port;
}

describe.skipIf(!DOCKER)("smoke: the compose deployment in Docker", () => {
	let fx: Fixture;
	let env: Record<string, string>;
	let port: number;
	const project = `maina-smoke-${process.pid}`;
	const compose = (...args: string[]) =>
		exec(
			[
				"docker",
				"compose",
				"-p",
				project,
				"-f",
				COMPOSE_FILE,
				"-f",
				SMOKE_COMPOSE,
				...args,
			],
			env,
		);

	beforeAll(async () => {
		fx = makeFixture();
		const out = join(fx.dir, "out");
		mkdirSync(out);
		chmodSync(out, 0o777);
		port = await freePort();
		env = {
			MAINA_IMAGE: `maina-remote:smoke-${process.pid}`,
			MAINA_POLICY_FILE: join(fx.home, ".maina", "policy.json"),
			MAINA_MODEL_DIR: join(fx.home, ".maina", "models"),
			MAINA_WORKSPACE: fx.origin,
			MAINA_REMOTE_PASSWORD: "a long smoke password",
			MAINA_PORT: String(port),
			MAINA_SMOKE_SRC: REPO_ROOT,
			MAINA_SMOKE_DIR: fx.dir,
			MAINA_SMOKE_PULL: JSON.stringify(pullFor(fx, "file:///fixture/origin")),
			MAINA_SMOKE_PRIVATE_KEY: fx.privateKey.replaceAll("\n", "\\n"),
			MAINA_SMOKE_PUBLIC_KEY: fx.publicKey.replaceAll("\n", "\\n"),
		};
		const built = await compose("build", "remote");
		if (built.exitCode !== 0) throw new Error(built.stderr);
		const up = await compose(
			"up",
			"-d",
			"--wait",
			"egress",
			"github",
			"remote",
			"ingress",
		);
		if (up.exitCode !== 0)
			throw new Error(`${up.stderr}\n${(await compose("logs")).stdout}`);
	}, 600_000);

	afterAll(async () => {
		await compose("down", "-v", "--remove-orphans");
		await exec(["docker", "image", "rm", "-f", env.MAINA_IMAGE ?? ""]);
		rmSync(fx.dir, { recursive: true, force: true });
	}, 120_000);

	test("runs one PR job with the policy file and model artifact, talking only to GitHub", async () => {
		const run = await compose("run", "--rm", "-T", "job", ...jobArgs);
		expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({
			exitCode: 0,
			stderr: expect.stringContaining(
				`policy ${IMAGE_MAINA}/policy.json (valid)`,
			),
		});
		expect(run.stderr).toContain(
			`model ${IMAGE_MAINA}/models (1 file: system1.onnx)`,
		);
		const report = JSON.parse(run.stdout) as {
			result: { answer: string }[];
			workspace: { removed: boolean };
		};
		expect(report.result[0]?.answer).toBe("bot");
		expect(report.workspace.removed).toBe(true);

		const attempts = readAttempts(join(fx.dir, "out", "network.jsonl"));
		expect(attempts.length).toBeGreaterThanOrEqual(5);
		expect(attempts.filter((a) => a.host !== "api.github.test")).toEqual([]);
	}, 120_000);

	test("the job container has no way out but the egress proxy, which refuses anything but GitHub", async () => {
		const probe = `
			const results = {};
			const attempt = async (name, fn) => {
				try { await fn(); results[name] = "reached"; }
				catch (e) { results[name] = "blocked"; }
			};
			await attempt("viaProxy", async () => {
				const r = await fetch("https://example.com/", { signal: AbortSignal.timeout(5000) });
				if (!r.ok) throw new Error(String(r.status));
			});
			await attempt("direct", () => new Promise((resolve, reject) => {
				const s = require("node:net").connect(443, "1.1.1.1");
				s.setTimeout(5000, () => { s.destroy(); reject(new Error("timeout")); });
				s.on("connect", () => { s.destroy(); resolve(); });
				s.on("error", reject);
			}));
			process.stdout.write(JSON.stringify(results));
		`;
		const run = await compose(
			"run",
			"--rm",
			"-T",
			"--entrypoint",
			"bun",
			"job",
			"-e",
			probe,
		);
		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout)).toEqual({
			viaProxy: "blocked",
			direct: "blocked",
		});

		const logs = await compose("logs", "--no-log-prefix", "egress");
		const events = logs.stdout
			.split("\n")
			.filter((l) => l.startsWith("{"))
			.map((l) => JSON.parse(l) as { host: string; allowed: boolean });
		expect(events).toContainEqual(
			expect.objectContaining({ host: "example.com", allowed: false }),
		);
		expect(events.filter((e) => e.allowed)).toEqual([]);
	}, 120_000);

	test("serves the MCP service through the ingress", async () => {
		const health = await fetch(`http://127.0.0.1:${port}/healthz`);
		expect(health.status).toBe(200);
		const meta = await fetch(
			`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`,
		);
		expect(meta.status).toBe(200);
		expect(((await meta.json()) as { resource: string }).resource).toBe(
			"http://localhost:8787/mcp",
		);
	}, 60_000);

	test("the helm chart lints and renders a GitHub-only egress policy", async () => {
		const helm = (...args: string[]) =>
			exec([
				"docker",
				"run",
				"--rm",
				"-v",
				`${CHART}:/chart:ro`,
				HELM_IMAGE,
				...args,
			]);
		const lint = await helm(
			"lint",
			"/chart",
			"--set",
			"remote.existingSecret=maina",
		);
		expect({ exitCode: lint.exitCode, out: lint.stdout }).toEqual({
			exitCode: 0,
			out: expect.stringContaining("0 chart(s) failed"),
		});
		const rendered = await helm(
			"template",
			"smoke",
			"/chart",
			"--set",
			"remote.existingSecret=maina",
		);
		expect(rendered.exitCode).toBe(0);
		type K8s = {
			kind: string;
			metadata: { name: string };
			spec: Record<string, unknown>;
		};
		const docs = rendered.stdout
			.split(/^---$/m)
			.map((d) => Bun.YAML.parse(d) as K8s | null)
			.filter((d): d is K8s => d !== null);
		const policies = docs.filter((d) => d.kind === "NetworkPolicy");
		expect(policies.length).toBe(2);
		const egressConfig = docs.find(
			(d) => d.kind === "Deployment" && d.metadata.name.endsWith("-egress"),
		);
		expect(JSON.stringify(egressConfig)).toContain("github.com,api.github.com");
	}, 300_000);
});
