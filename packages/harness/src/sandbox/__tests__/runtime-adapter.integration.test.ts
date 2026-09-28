/**
 * The sandbox-runtime adapter against a real srt on this machine.
 * Skipped, saying why, where srt cannot run; MAINA_REQUIRE_SANDBOX=1 turns
 * that skip into a failure. The unit cases, over a fake machine, are in
 * runtime-adapter.test.ts.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY } from "@mainahq/core";
import { shallowTmpDir } from "../../__tests__/test-tmp";
import { policyToSandbox } from "../policy-to-sandbox";
import type { SandboxOptions } from "../port";
import {
	createSandboxRuntime,
	detectSandboxRuntime,
	SANDBOX_RUNTIME,
} from "../runtime-adapter";
import { removeTmpRoot } from "../tmp-root";
import {
	integrationTitle,
	type Layout,
	makeLayout,
	REQUIRE_SANDBOX,
	run,
	SKIP_REASON,
	shell,
} from "./sandbox-fixture";

test.if(REQUIRE_SANDBOX && SKIP_REASON !== undefined)(
	"the sandbox runtime is installed (MAINA_REQUIRE_SANDBOX=1)",
	() => {
		throw new Error(`sandbox runtime unavailable: ${SKIP_REASON}`);
	},
);

function sandboxFor(layout: Layout, extra: Partial<SandboxOptions> = {}) {
	const base = policyToSandbox(
		DEFAULT_POLICY,
		layout.worktree,
		layout.holdout,
		{ home: layout.home, tmpDir: layout.tmp },
	);
	if (!base.ok) throw new Error(base.error.message);
	return { ...base.value, ...extra };
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		return statSync(full).isDirectory() ? filesUnder(full) : [full];
	});
}

const INTEGRATION_MS = 30_000;

/** Every port an integration test made, disposed after it. */
const ports: ReturnType<typeof createSandboxRuntime>[] = [];
function sandboxRuntime(deps?: Parameters<typeof createSandboxRuntime>[0]) {
	const port = createSandboxRuntime(deps);
	ports.push(port);
	return port;
}

describe.skipIf(SKIP_REASON !== undefined)(
	integrationTitle("srt sandbox (integration)"),
	() => {
		afterEach(() => {
			for (const port of ports.splice(0)) port.dispose();
		});

		test(
			"a wrap leaves no new entries in the parent tmpdir (#632)",
			async () => {
				const layout = makeLayout();
				// Shallow, like a real TMPDIR: srt binds its sockets in there.
				const parent = shallowTmpDir();
				const before = readdirSync(parent);
				const previous = process.env.TMPDIR;
				process.env.TMPDIR = parent;
				try {
					const port = createSandboxRuntime({ env: process.env });
					const wrappedCmd = port.wrap(
						shell("echo ran"),
						sandboxFor(layout, {
							// A masked credential makes srt mint its ephemeral CA.
							credentials: [
								{
									name: "MAINA_TEST_API_KEY",
									value: "sk-leak-632",
									hosts: ["api.example.com"],
								},
							],
						}),
					);
					if (!wrappedCmd.ok) throw new Error(wrappedCmd.error.message);
					const ran = await run(wrappedCmd.value, layout.worktree);
					expect(ran.stdout).toBe("ran\n");
					port.dispose();
					expect(readdirSync(parent)).toEqual(before);
				} finally {
					if (previous === undefined) delete process.env.TMPDIR;
					else process.env.TMPDIR = previous;
					removeTmpRoot(parent);
				}
			},
			INTEGRATION_MS,
		);

		test(
			"writes outside the worktree fail; writes inside succeed",
			async () => {
				const layout = makeLayout();
				const port = sandboxRuntime();
				const outside = join(layout.outside, "escaped.txt");
				const inside = join(layout.worktree, "made.txt");
				const wrappedCmd = port.wrap(
					shell(`echo in > '${inside}'; echo out > '${outside}'`),
					sandboxFor(layout),
				);
				if (!wrappedCmd.ok) throw new Error(wrappedCmd.error.message);
				const ran = await run(wrappedCmd.value, layout.worktree);
				expect(existsSync(inside)).toBe(true);
				expect(existsSync(outside)).toBe(false);
				expect(ran.stderr).toMatch(/not permitted|denied|read-only/i);
			},
			INTEGRATION_MS,
		);

		test(
			"reads of ~/.ssh, other worktrees and the holdout directory fail",
			async () => {
				const layout = makeLayout();
				const port = sandboxRuntime();
				const script = [
					`cat '${join(layout.home, ".ssh", "id_rsa")}'`,
					`cat '${join(layout.otherWorktree, "notes.txt")}'`,
					`cat '${join(layout.holdout, "answers.txt")}'`,
					`cat '${join(layout.worktree, "README.md")}'`,
				].join("; ");
				const wrappedCmd = port.wrap(shell(script), sandboxFor(layout));
				if (!wrappedCmd.ok) throw new Error(wrappedCmd.error.message);
				const ran = await run(wrappedCmd.value, layout.worktree);
				expect(ran.stdout).toContain("own worktree");
				expect(ran.stdout).not.toContain("PRIVATE-KEY-316");
				expect(ran.stdout).not.toContain("OTHER-RUN-316");
				expect(ran.stdout).not.toContain("HOLDOUT-316");
			},
			INTEGRATION_MS,
		);

		test(
			"a non-allowlisted host is blocked and logged as a decision",
			async () => {
				const layout = makeLayout();
				const port = sandboxRuntime();
				const wrappedCmd = port.wrap(
					shell(
						"curl -sS -o /dev/null --max-time 10 https://not-allowlisted.example.com/; echo curl=$?",
					),
					sandboxFor(layout, { netAllow: ["allowed.example.com"] }),
				);
				if (!wrappedCmd.ok) throw new Error(wrappedCmd.error.message);
				const ran = await run(wrappedCmd.value, layout.worktree);
				expect(ran.stdout).not.toContain("curl=0");
				expect(port.decisions(ran.stderr)).toContainEqual({
					kind: "network",
					host: "not-allowlisted.example.com",
					port: 443,
					verdict: "deny",
					reason: "not_allowlisted",
				});
			},
			INTEGRATION_MS,
		);

		test(
			"the worker's temp files land in its own temp dir",
			async () => {
				const layout = makeLayout();
				const port = sandboxRuntime();
				const wrappedCmd = port.wrap(
					shell('echo "$TMPDIR"; mktemp "$TMPDIR/maina.XXXXXX"'),
					sandboxFor(layout),
				);
				if (!wrappedCmd.ok) throw new Error(wrappedCmd.error.message);
				const ran = await run(wrappedCmd.value, layout.worktree);
				expect(ran.exitCode).toBe(0);
				const [tmpdirSeen, made] = ran.stdout.trim().split("\n");
				expect(tmpdirSeen).toBe(layout.tmp);
				expect(made?.startsWith(layout.tmp)).toBe(true);
			},
			INTEGRATION_MS,
		);

		test(
			"credentials never appear in the worker's env or files",
			async () => {
				const layout = makeLayout();
				const secret = "sk-real-credential-316";
				const ambient = "ghp_ambient_token_316";
				const env = { ...process.env, GITHUB_TOKEN: ambient };
				const port = sandboxRuntime({ env });
				const dump = join(layout.worktree, "env.txt");
				const wrappedCmd = port.wrap(
					shell(`env > '${dump}'; env > '${join(layout.tmp, "env.txt")}'; env`),
					sandboxFor(layout, {
						credentials: [
							{
								name: "MAINA_TEST_API_KEY",
								value: secret,
								hosts: ["api.example.com"],
							},
						],
					}),
				);
				if (!wrappedCmd.ok) throw new Error(wrappedCmd.error.message);
				const ran = await run(wrappedCmd.value, layout.worktree, env);
				expect(ran.exitCode).toBe(0);
				// The worker sees the variable, holding a stand-in.
				expect(ran.stdout).toMatch(/^MAINA_TEST_API_KEY=.+$/m);
				const settingsPath =
					wrappedCmd.value.args?.[
						(wrappedCmd.value.args?.indexOf("--settings") ?? -2) + 1
					];
				const scanned = [
					ran.stdout,
					...filesUnder(layout.base).map((f) => readFileSync(f, "utf8")),
					readFileSync(String(settingsPath), "utf8"),
				];
				for (const text of scanned) {
					expect(text).not.toContain(secret);
					expect(text).not.toContain(ambient);
				}
			},
			INTEGRATION_MS,
		);
	},
);

// Keeps the detection honest on machines that do have srt: it resolves to
// the pinned package, not whatever `srt --version` claims (it prints 1.0.0).
test.skipIf(SKIP_REASON !== undefined)(
	integrationTitle("detectSandboxRuntime reads the installed package version"),
	() => {
		const found = detectSandboxRuntime();
		expect(found.ok).toBe(true);
		if (!found.ok) return;
		expect(found.value.version).toBe(SANDBOX_RUNTIME.version);
	},
);
