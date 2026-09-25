import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY, type Result } from "@mainahq/core";
import type { WorkerProbe } from "../../workers/probe";
import { resolveWorker, type WorkerSpec } from "../../workers/registry";
import { configureInnerSandbox, INNER_SANDBOX_NESTS } from "../nested";
import { policyToSandbox } from "../policy-to-sandbox";
import type { SandboxError } from "../port";
import {
	createSandboxRuntime,
	detectSandboxRuntime,
	SANDBOX_RUNTIME,
} from "../runtime-adapter";
import {
	integrationTitle,
	makeLayout,
	run,
	SKIP_REASON,
	shell,
} from "./sandbox-fixture";

const PATH_PROBE: WorkerProbe = {
	which: (binary) => `/opt/bin/${binary}`,
	version: () => null,
};

function worker(name: string): WorkerSpec {
	const result = resolveWorker(name, PATH_PROBE);
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}

describe("configureInnerSandbox: where the inner sandbox cannot nest", () => {
	test("codex over ACP starts in full-access mode and loses the gate", () => {
		const configured = configureInnerSandbox(worker("codex"), {
			platform: "darwin",
		});
		expect(configured.inner).toBe("disabled");
		expect(configured.worker.launch.env).toEqual({
			INITIAL_AGENT_MODE: "agent-full-access",
		});
		// Full access also means codex stops asking: only the sandbox enforces.
		expect(configured.worker.enforcement).toBe("sandbox-only");
		expect(configured.worker.capabilities.permissionRequests).toBe(false);
	});

	test("headless codex gets its root flag ahead of `exec`", () => {
		const configured = configureInnerSandbox(worker("headless:codex"), {
			platform: "darwin",
		});
		expect(configured.inner).toBe("disabled");
		expect(configured.worker.launch.args).toEqual([
			"-c",
			'sandbox_mode="danger-full-access"',
			"exec",
			"--json",
			"-",
		]);
	});

	test("cursor turns its sandbox off and keeps asking", () => {
		const configured = configureInnerSandbox(worker("cursor"), {
			platform: "darwin",
		});
		expect(configured.worker.launch.args).toEqual([
			"--sandbox",
			"disabled",
			"acp",
		]);
		expect(configured.worker.enforcement).toBe("gate");
	});

	test("claude's sandbox is opt-in: nothing to pass, the launch is unchanged", () => {
		const spec = worker("claude");
		const configured = configureInnerSandbox(spec, { platform: "darwin" });
		expect(configured.inner).toBe("disabled");
		expect(configured.worker.launch).toEqual(spec.launch);
		expect(configured.worker.enforcement).toBe("gate");
	});

	test("a container sandbox never nests, on any platform", () => {
		for (const platform of ["darwin", "linux"]) {
			const configured = configureInnerSandbox(worker("gemini"), {
				platform,
				nests: ["gemini"],
			});
			expect(configured.inner).toBe("disabled");
			expect(configured.worker.launch.env).toEqual({
				GEMINI_SANDBOX: "false",
			});
		}
	});

	test("an agent with no sandbox of its own is left alone", () => {
		const spec = worker("opencode");
		expect(configureInnerSandbox(spec, { platform: "darwin" })).toEqual({
			worker: spec,
			inner: "none",
		});
	});

	test("an unknown platform is treated as one where nothing nests", () => {
		const configured = configureInnerSandbox(worker("codex"), {
			platform: "freebsd",
		});
		expect(configured.inner).toBe("disabled");
	});
});

describe("configureInnerSandbox: where it nests", () => {
	test("the agent's own sandbox stays on, under the outer one", () => {
		const spec = worker("codex");
		const configured = configureInnerSandbox(spec, {
			platform: "linux",
			nests: ["codex"],
		});
		expect(configured).toEqual({ worker: spec, inner: "nested" });
	});

	test("the recorded spike: nothing nests under srt on macOS", () => {
		expect(INNER_SANDBOX_NESTS.darwin).toEqual([]);
	});
});

describe("configureInnerSandbox leaves the outer sandbox intact", () => {
	test("the configured launch is still wrapped by srt, patch inside it", () => {
		const configured = configureInnerSandbox(worker("headless:codex"), {
			platform: "darwin",
		});
		const port = createSandboxRuntime({
			probe: {
				which: (binary) => `/opt/bin/${binary}`,
				version: () => SANDBOX_RUNTIME.version,
			},
			platform: "darwin",
			env: {},
			writeSettings: (): Result<string, SandboxError> => ({
				ok: true,
				value: "/tmp/s.json",
			}),
		});
		const opts = policyToSandbox(DEFAULT_POLICY, "/w/r/run-1", "/w/holdout", {
			home: "/home/dev",
		});
		if (!opts.ok) throw new Error(opts.error.message);
		const wrapped = port.wrap(configured.worker.launch, opts.value);
		if (!wrapped.ok) throw new Error(wrapped.error.message);
		expect(wrapped.value.command).toBe("/opt/bin/srt");
		const args = wrapped.value.args ?? [];
		const inner = args.slice(args.indexOf("--") + 1);
		expect(inner).toEqual([
			"/opt/bin/codex",
			"-c",
			'sandbox_mode="danger-full-access"',
			"exec",
			"--json",
			"-",
		]);
	});
});

// ── The nested-sandbox spike (ADR 0048), rerun on every machine with srt ────
//
// Each agent's own sandbox engine is started inside maina's: Claude Code's
// is sandbox-runtime itself, Codex's is `codex sandbox`. The outcome must
// match `INNER_SANDBOX_NESTS`, the table `configureInnerSandbox` reads; if
// an OS or agent release changes it, this fails and the ADR needs a revisit.

const platform = process.platform;
const nestsHere: readonly string[] =
	(INNER_SANDBOX_NESTS as Readonly<Record<string, readonly string[]>>)[
		platform
	] ?? [];

/**
 * Prints the spike's outcome, with the inner sandbox's own stderr (srt's
 * debug lines dropped), so a CI log is enough to update ADR 0048.
 */
function report(worker: string, started: boolean, stderr: string): void {
	const own = stderr
		.split("\n")
		.filter((line) => line.trim() !== "" && !line.startsWith("[SandboxDebug]"))
		.slice(-5)
		.join(" | ");
	process.stderr.write(
		`[spike] ${worker} inner sandbox on ${platform}: ${started ? "starts" : "fails"}${own === "" ? "" : `: ${own}`}\n`,
	);
}

async function startsUnderOuter(innerScript: (tmp: string) => string) {
	const layout = makeLayout();
	const opts = policyToSandbox(
		DEFAULT_POLICY,
		layout.worktree,
		layout.holdout,
		{
			home: layout.home,
			tmpDir: layout.tmp,
		},
	);
	if (!opts.ok) throw new Error(opts.error.message);
	const port = createSandboxRuntime();
	const wrapped = port.wrap(shell(innerScript(layout.tmp)), opts.value);
	if (!wrapped.ok) throw new Error(wrapped.error.message);
	const ran = await run(wrapped.value, layout.worktree);
	return { started: ran.stdout.includes("inner-ok"), ran };
}

const SPIKE_MS = 60_000;

describe.skipIf(SKIP_REASON !== undefined)(
	integrationTitle("nested-sandbox spike"),
	() => {
		test(
			"Claude's inner sandbox (sandbox-runtime) under the outer one",
			async () => {
				const srt = detectSandboxRuntime();
				if (!srt.ok) throw new Error(srt.error.message);
				const { started, ran } = await startsUnderOuter((tmp) => {
					const inner = join(tmp, "inner-settings.json");
					writeFileSync(
						inner,
						JSON.stringify({
							network: { allowedDomains: [], deniedDomains: [] },
							filesystem: { denyRead: [], allowWrite: [tmp], denyWrite: [] },
						}),
					);
					return `HOME='${tmp}' '${srt.value.path}' --settings '${inner}' -- /bin/echo inner-ok`;
				});
				report("claude", started, ran.stderr);
				expect({
					worker: "claude",
					platform,
					started,
					stderr: ran.stderr,
				}).toMatchObject({
					worker: "claude",
					platform,
					started: nestsHere.includes("claude"),
				});
			},
			SPIKE_MS,
		);

		const codex = Bun.which("codex");
		test.skipIf(codex === null)(
			`Codex's inner sandbox (codex sandbox) under the outer one${codex === null ? " [skipped: codex is not on PATH]" : ""}`,
			async () => {
				const { started, ran } = await startsUnderOuter(
					(tmp) =>
						`HOME='${tmp}' CODEX_HOME='${tmp}' '${codex}' sandbox -- /bin/echo inner-ok`,
				);
				report("codex", started, ran.stderr);
				expect({
					worker: "codex",
					platform,
					started,
					stderr: ran.stderr,
				}).toMatchObject({
					worker: "codex",
					platform,
					started: nestsHere.includes("codex"),
				});
			},
			SPIKE_MS,
		);
	},
);
