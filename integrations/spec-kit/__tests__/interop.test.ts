/**
 * Spec Kit interop (mainahq/maina#333, FR-SPEC-7).
 *
 * Three contracts:
 *
 * 1. A Spec Kit workflow `shell` step can consume `maina decide --json` and
 *    `switch` on its `verdict` (`workflows/maina-gate-overlay.yml` gates the
 *    stock `speckit` workflow's `implement` step that way).
 * 2. The Spec Kit extension (`extension/`) registers the `pre_tool_use` agent
 *    event to `speckit.maina.gate`, which hands the host's hook payload to
 *    the Maina gate (`maina hook --host <host> <event>`) and fails closed
 *    like the runtime's `failClosedHook(host, event, cause)`.
 * 3. Maina reads Spec Kit `specs/<feature>/{spec,plan,tasks}.md` as feature
 *    input (`maina analyze`).
 *
 * The static checks always run. The `live` cases drive a stock Spec Kit v1
 * CLI (`specify`, or `SPECIFY_BIN`); they are skipped when none is
 * installed, unless `MAINA_REQUIRE_SPECKIT=1` (CI) makes a missing CLI a
 * failure. CI pins the Spec Kit version in `.github/workflows/ci.yml`.
 */

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	failClosedHook,
	type HookHost,
} from "../../../packages/runtime/src/standalone/hook-fallback";

// Spec Kit is a Python CLI: each `specify` call costs ~0.5 s to start.
setDefaultTimeout(120_000);

const REPO = resolve(import.meta.dir, "../../..");
const INTEGRATION = resolve(import.meta.dir, "..");
const EXTENSION = join(INTEGRATION, "extension");
const OVERLAY = join(INTEGRATION, "workflows", "maina-gate-overlay.yml");
const FIXTURES = join(import.meta.dir, "fixtures");
const CLI = join(REPO, "packages", "cli", "src", "index.ts");
const HOOK_FIXTURES = join(
	REPO,
	"packages",
	"runtime",
	"src",
	"adapters",
	"__fixtures__",
);

/** The stock `speckit` workflow's step ids (Spec Kit v1.0.12). */
const STOCK_SPECKIT_STEPS = [
	"specify",
	"review-spec",
	"plan",
	"review-plan",
	"tasks",
	"implement",
];

/** Spec Kit's `CANONICAL_EVENTS` (src/specify_cli/events/__init__.py). */
const CANONICAL_EVENTS = [
	"session_start",
	"pre_tool_use",
	"post_tool_use",
	"session_end",
	"user_prompt_submit",
	"stop",
];

type Yaml = Record<string, unknown>;

function readYaml(path: string): Yaml {
	return Bun.YAML.parse(readFileSync(path, "utf8")) as Yaml;
}

/** The YAML frontmatter of a Spec Kit command template. */
function frontmatter(path: string): Yaml {
	const match = readFileSync(path, "utf8").match(/^---\n([\s\S]*?)\n---/);
	return match?.[1] ? (Bun.YAML.parse(match[1]) as Yaml) : {};
}

function hookPayload(host: string, file: string): string {
	return readFileSync(join(HOOK_FIXTURES, host, file), "utf8");
}

// ── Sandboxes ───────────────────────────────────────────────────────────────

const cleanup: string[] = [];
afterAll(() => {
	for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

type Sandbox = Readonly<{
	/** The project: a copy of `fixtures/project` unless `empty`. */
	dir: string;
	home: string;
	bin: string;
	env: Record<string, string>;
}>;

/**
 * A stub `maina` that records its arguments and stdin, prints `reply` (and
 * `stderr` on stderr) and exits with `exitCode`.
 */
function stubMaina(reply: string, exitCode = 0, stderr = ""): string {
	return [
		"#!/bin/sh",
		'here=$(dirname "$0")',
		'printf \'%s\' "$*" > "$here/args.txt"',
		'cat > "$here/stdin.json"',
		`printf '%s' '${reply}'`,
		`printf '%s' '${stderr}' >&2`,
		`exit ${exitCode}`,
		"",
	].join("\n");
}

const REAL_MAINA = `#!/bin/sh\nexec bun "${CLI}" "$@"\n`;

function sandbox(
	options: { maina?: string | null; empty?: boolean } = {},
): Sandbox {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "maina-333-")));
	cleanup.push(root);
	const dir = join(root, "project");
	if (options.empty) mkdirSync(dir);
	else cpSync(join(FIXTURES, "project"), dir, { recursive: true });
	const home = join(root, "home");
	const bin = join(root, "bin");
	mkdirSync(home);
	mkdirSync(bin);
	const maina = options.maina === undefined ? REAL_MAINA : options.maina;
	if (maina !== null) {
		writeFileSync(join(bin, "maina"), maina);
		chmodSync(join(bin, "maina"), 0o755);
	}
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		// CLAUDE_PROJECT_DIR marks a Claude Code hook run: tests set it.
		if (
			value !== undefined &&
			!key.startsWith("SPECIFY_") &&
			key !== "CLAUDE_PROJECT_DIR"
		) {
			env[key] = value;
		}
	}
	Object.assign(env, {
		PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
		HOME: home,
		MAINA_TELEMETRY: "0",
		DO_NOT_TRACK: "1",
	});
	return { dir, home, bin, env };
}

type Run = Readonly<{ code: number; stdout: string; stderr: string }>;

function run(
	cmd: readonly string[],
	sb: Sandbox,
	options: { stdin?: string; env?: Record<string, string> } = {},
): Run {
	const proc = Bun.spawnSync([...cmd], {
		cwd: sb.dir,
		env: { ...sb.env, ...options.env },
		stdin:
			options.stdin === undefined
				? "ignore"
				: new TextEncoder().encode(options.stdin),
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: proc.exitCode ?? -1,
		stdout: proc.stdout.toString(),
		stderr: proc.stderr.toString(),
	};
}

function writePolicy(sb: Sandbox, verdict: "allow" | "ask" | "deny"): void {
	mkdirSync(join(sb.dir, ".maina"), { recursive: true });
	writeFileSync(
		join(sb.dir, ".maina", "policy.json"),
		JSON.stringify({
			action_classes: {
				"speckit.implement": { irreversible: false, verdict },
			},
		}),
	);
}

// ── Spec Kit CLI detection ──────────────────────────────────────────────────

const SPECIFY = process.env.SPECIFY_BIN ?? "specify";

function specKitV1Available(): boolean {
	try {
		// `workflow overlay` is Spec Kit v1's; 0.x has neither.
		const probe = Bun.spawnSync([SPECIFY, "workflow", "overlay", "--help"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		return probe.exitCode === 0;
	} catch {
		return false;
	}
}

const SPEC_KIT = specKitV1Available();
const REQUIRE_SPEC_KIT = process.env.MAINA_REQUIRE_SPECKIT === "1";
const live = SPEC_KIT || REQUIRE_SPEC_KIT ? test : test.skip;

function specify(sb: Sandbox, args: readonly string[], stdin?: string): Run {
	return run([SPECIFY, ...args], sb, { stdin });
}

// ── 2. The extension ────────────────────────────────────────────────────────

describe("Spec Kit extension manifest", () => {
	const manifest = readYaml(join(EXTENSION, "extension.yml"));
	const extension = manifest.extension as Yaml;
	const provides = manifest.provides as Yaml;
	const commands = (provides.commands ?? []) as readonly Yaml[];
	const provided = new Set(commands.map((c) => c.name));

	test("is a schema 1.0 manifest for the maina extension", () => {
		expect(manifest.schema_version).toBe("1.0");
		expect(extension.id).toBe("maina");
		for (const field of ["name", "version", "description"]) {
			expect(typeof extension[field]).toBe("string");
		}
		expect(extension.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect((manifest.requires as Yaml).speckit_version).toMatch(/^>=1\./);
		expect(commands.length).toBeGreaterThan(0);
		for (const command of commands) {
			expect(command.name).toMatch(/^speckit\.maina\.[a-z0-9-]+$/);
			expect(String(command.file)).not.toContain("..");
			expect(existsSync(join(EXTENSION, String(command.file)))).toBe(true);
		}
	});

	test("registers pre_tool_use to speckit.maina.gate, a script that runs the Maina gate", () => {
		const events = manifest.events as Yaml;
		for (const event of Object.keys(events)) {
			expect(CANONICAL_EVENTS).toContain(event);
		}
		const preToolUse = events.pre_tool_use as Yaml;
		expect(preToolUse.command).toBe("speckit.maina.gate");
		expect(provided.has("speckit.maina.gate")).toBe(true);
		expect(preToolUse.matcher ?? "*").toBe("*");
		expect(Number.isInteger(preToolUse.timeout)).toBe(true);

		const gate = commands.find((c) => c.name === "speckit.maina.gate");
		const scripts = frontmatter(join(EXTENSION, String(gate?.file)))
			.scripts as Yaml;
		const script = join(EXTENSION, String(scripts.sh));
		expect(scripts.sh).toBe("events/pre-tool-use.sh");
		expect(statSync(script).mode & 0o111).not.toBe(0);
		expect(readFileSync(script, "utf8")).toContain("hook");
	});

	test("every lifecycle hook names a command the extension provides", () => {
		const hooks = (manifest.hooks ?? {}) as Record<string, Yaml>;
		for (const hook of Object.values(hooks)) {
			expect(provided.has(hook.command)).toBe(true);
		}
	});
});

describe("pre_tool_use handler", () => {
	const script = join(EXTENSION, "events", "pre-tool-use.sh");
	/** Claude Code sets it for every hook command (Spec Kit's needs it). */
	const inClaudeCode = { CLAUDE_PROJECT_DIR: "/home/user/project" };

	/**
	 * Which host a payload is routed to (`maina hook --host <host> <event>`),
	 * or `undefined` when nothing names the host: a PascalCase event could be
	 * Claude Code or Codex, so `maina hook <event>` fails closed as ambiguous.
	 */
	const cases: readonly Readonly<{
		name: string;
		fixture: readonly [string, string];
		env: Record<string, string>;
		host: HookHost | undefined;
		event: string;
	}>[] = [
		{
			name: "a Claude Code payload in a Claude Code hook",
			fixture: ["claude-code", "pre-tool-use.bash.input.json"],
			env: inClaudeCode,
			host: "claude",
			event: "PreToolUse",
		},
		{
			name: "a Codex payload",
			fixture: ["codex", "pre-tool-use.bash.input.json"],
			env: {},
			host: "codex",
			event: "PreToolUse",
		},
		{
			// A Codex payload always carries turn_id; it beats the environment.
			name: "a Codex payload with CLAUDE_PROJECT_DIR set",
			fixture: ["codex", "pre-tool-use.apply-patch.input.json"],
			env: inClaudeCode,
			host: "codex",
			event: "PreToolUse",
		},
		{
			name: "a Cursor preToolUse payload",
			fixture: ["cursor", "pre-tool-use.shell.input.json"],
			env: {},
			host: "cursor",
			event: "preToolUse",
		},
		{
			name: "a Cursor beforeShellExecution payload",
			fixture: ["cursor", "before-shell-execution.input.json"],
			env: {},
			host: "cursor",
			event: "beforeShellExecution",
		},
		{
			name: "a Cursor beforeMCPExecution payload",
			fixture: ["cursor", "before-mcp-execution.stdio.input.json"],
			env: {},
			host: "cursor",
			event: "beforeMCPExecution",
		},
		{
			name: "a PascalCase payload no host is known for",
			fixture: ["claude-code", "pre-tool-use.bash.input.json"],
			env: {},
			host: undefined,
			event: "PreToolUse",
		},
	];

	const hookArgs = (host: HookHost | undefined, event: string) =>
		host === undefined ? `hook ${event}` : `hook --host ${host} ${event}`;

	for (const { name, fixture, env, host, event } of cases) {
		const args = hookArgs(host, event);

		test(`hands ${name} to \`maina ${args}\` and prints its answer`, () => {
			const reply = '{"decision":"from-maina"}';
			const sb = sandbox({ maina: stubMaina(reply) });
			const payload = hookPayload(...fixture);

			const result = run([script], sb, { stdin: payload, env });

			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe(reply);
			expect(readFileSync(join(sb.bin, "args.txt"), "utf8")).toBe(args);
			expect(
				JSON.parse(readFileSync(join(sb.bin, "stdin.json"), "utf8")),
			).toEqual(JSON.parse(payload));
		});

		test(`fails closed like the runtime for ${name} when maina cannot answer`, () => {
			const payload = hookPayload(...fixture);
			const expected = failClosedHook(host, event, "gate_unavailable");
			const broken = [
				sandbox({ maina: null }),
				sandbox({ maina: stubMaina('{"x":1}', 1, "boom") }),
				sandbox({ maina: stubMaina("") }),
				// The npm CLI has no `hook` command yet: it exits non-zero.
				sandbox(),
			];
			for (const sb of broken) {
				const result = run([script], sb, {
					stdin: payload,
					env: { ...env, PATH: `${sb.bin}:/usr/bin:/bin:${dirOfBun()}` },
				});
				expect(result.stdout).toBe(`${expected.line}\n`);
				expect(result.stderr).toBe(expected.stderr);
				expect(result.code).toBe(expected.exitCode);
			}
		});
	}

	test("passes maina's deny through with its exit code 2 and stderr", () => {
		const deny =
			'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"blocked by policy"}}';
		const sb = sandbox({ maina: stubMaina(deny, 2, "blocked by policy") });
		const tmp = join(sb.home, "tmp");
		mkdirSync(tmp);

		const result = run([script], sb, {
			stdin: hookPayload("claude-code", "pre-tool-use.bash.input.json"),
			env: { ...inClaudeCode, TMPDIR: tmp },
		});

		expect(result.code).toBe(2);
		expect(result.stdout).toBe(`${deny}\n`);
		expect(result.stderr).toBe("blocked by policy");
		// The file that held maina's stderr is gone.
		expect(readdirSync(tmp)).toEqual([]);
	});

	// A host that times a hook out kills it. dash (Debian's and Ubuntu's
	// /bin/sh) skips the EXIT trap on a signal, so the handler traps them.
	const shells = [
		"/bin/sh",
		...(Bun.which("dash") ? [Bun.which("dash") as string] : []),
	];
	for (const shell of shells) {
		test(`removes its temp file when the host kills it (${shell})`, async () => {
			const sb = sandbox({
				maina: "#!/bin/sh\ncat >/dev/null\nsleep 1\nprintf '{}'\n",
			});
			const tmp = join(sb.home, "tmp");
			mkdirSync(tmp);
			const proc = Bun.spawn([shell, script], {
				cwd: sb.dir,
				env: { ...sb.env, TMPDIR: tmp },
				stdin: new TextEncoder().encode(
					hookPayload("cursor", "pre-tool-use.shell.input.json"),
				),
				stdout: "ignore",
				stderr: "ignore",
			});
			// Wait until the handler has made its temp file, then kill it.
			const started = Date.now();
			while (readdirSync(tmp).length === 0 && Date.now() - started < 5000) {
				await Bun.sleep(20);
			}
			expect(readdirSync(tmp)).toHaveLength(1);
			proc.kill("SIGTERM");
			await proc.exited;

			expect(readdirSync(tmp)).toEqual([]);
		});
	}

	test("a payload without a pre-tool event name is treated as PreToolUse", () => {
		const payloads = [
			'{"tool_name":"Bash"}',
			// A tool argument cannot pick the event: only pre-tool names count.
			'{"tool_name":"mcp__x","tool_input":{"hook_event_name":"SessionStart"}}',
		];
		for (const stdin of payloads) {
			const sb = sandbox({ maina: stubMaina("{}") });
			run([script], sb, { stdin, env: inClaudeCode });
			expect(readFileSync(join(sb.bin, "args.txt"), "utf8")).toBe(
				"hook --host claude PreToolUse",
			);
		}
	});
});

function dirOfBun(): string {
	return resolve(process.execPath, "..");
}

// ── 1. maina decide --json in a workflow ────────────────────────────────────

describe("maina decide --json (what the shell step consumes)", () => {
	test("prints a verdict an expression can read, exiting 0 for every verdict", () => {
		const sb = sandbox();
		const cmd = [
			"maina",
			"decide",
			"--type",
			"action.risk",
			"--trusted",
			"actionClass=speckit.implement",
			"--json",
		];
		const unknown = run(cmd, sb);
		expect(unknown.code).toBe(0);
		expect(JSON.parse(unknown.stdout).data.verdict).toBe("ask");

		writePolicy(sb, "deny");
		const denied = run(cmd, sb);
		expect(denied.code).toBe(0);
		expect(JSON.parse(denied.stdout).data.verdict).toBe("deny");
	});
});

describe("maina-gate workflow overlay", () => {
	const overlay = readYaml(OVERLAY);
	const edits = overlay.edits as readonly Yaml[];
	const anchorOf = (edit: Yaml) =>
		String(
			edit.insert_after ?? edit.insert_before ?? edit.replace ?? edit.anchor,
		);
	const steps = edits.map((e) => e.step as Yaml);
	const byId = (id: string) => steps.find((s) => s.id === id);

	test("is a valid overlay on the stock speckit workflow", () => {
		expect(overlay.id).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
		expect(overlay.extends).toBe("speckit");
		for (const edit of edits) {
			expect(STOCK_SPECKIT_STEPS).toContain(anchorOf(edit));
		}
		const ids = steps.map((s) => String(s.id));
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).not.toContain(":");
	});

	test("reads the Spec Kit artifacts with maina analyze after tasks", () => {
		const edit = edits.find((e) => e.insert_after === "tasks");
		const step = edit?.step as Yaml;
		expect(step.type).toBe("shell");
		expect(String(step.run)).toMatch(/^maina analyze\b.*--json/);
	});

	test("routes implement on the verdict of maina decide, failing closed", () => {
		const verdict = byId("maina-verdict");
		expect(verdict?.type).toBe("shell");
		expect(verdict?.output_format).toBe("json");
		expect(String(verdict?.run)).toMatch(
			/^maina decide --type action\.risk .*--json$/,
		);

		const route = byId("maina-route");
		expect(route?.type).toBe("switch");
		expect(route?.expression).toBe(
			"{{ steps.maina-verdict.output.data.data.verdict }}",
		);
		const cases = route?.cases as Record<string, readonly Yaml[]>;
		expect(Object.keys(cases).sort()).toEqual(["allow", "deny"]);
		expect(String(cases.deny?.[0]?.run)).toContain("exit 1");
		// `ask`, and anything unexpected, stops at a human review gate.
		const fallback = route?.default as readonly Yaml[];
		expect(fallback[0]?.type).toBe("gate");
		expect(fallback[0]?.on_reject).toBe("abort");
		for (const id of ["maina-verdict", "maina-route"]) {
			const edit = edits.find((e) => (e.step as Yaml).id === id);
			expect(edit?.insert_before).toBe("implement");
		}
	});
});

// ── 3. Spec Kit artifacts as Maina feature input ────────────────────────────

describe("Maina reads Spec Kit spec/plan/tasks", () => {
	test("maina analyze finds the feature from .specify/feature.json and reads its tasks", () => {
		const sb = sandbox();
		const result = run(["maina", "analyze", "--json"], sb);
		const report = JSON.parse(result.stdout);
		expect(report.analyzed).toBe(true);
		expect(report.reports).toHaveLength(1);
		expect(report.reports[0].featureDir).toBe(
			join(sb.dir, "specs", "001-photo-albums"),
		);
		expect(report.passed).toBe(true);
		expect(result.code).toBe(0);
	});
});

// ── Live: a stock Spec Kit v1 CLI ───────────────────────────────────────────

describe("with a stock Spec Kit v1 CLI", () => {
	if (REQUIRE_SPEC_KIT) {
		test("the Spec Kit v1 CLI is installed", () => {
			expect(SPEC_KIT).toBe(true);
		});
	}

	live(
		"a shell step consumes maina decide --json and switches on the verdict",
		() => {
			const workflow = join(FIXTURES, "decide-switch.workflow.yml");
			for (const verdict of [undefined, "allow", "deny"] as const) {
				const sb = sandbox();
				if (verdict !== undefined) writePolicy(sb, verdict);
				const result = specify(sb, ["workflow", "run", workflow]);
				expect(result.stdout).toContain("Status: completed");
				expect(result.code).toBe(0);
				expect(readFileSync(join(sb.dir, "outcome.txt"), "utf8").trim()).toBe(
					verdict ?? "ask",
				);
			}
		},
	);

	live(
		"the overlay gates speckit's implement step on the Maina verdict",
		() => {
			const trail = (sb: Sandbox) =>
				existsSync(join(sb.dir, "trail.txt"))
					? readFileSync(join(sb.dir, "trail.txt"), "utf8").trim().split("\n")
					: [];
			const install = (sb: Sandbox) => {
				const added = specify(sb, [
					"workflow",
					"add",
					"--dev",
					join(FIXTURES, "speckit-stub"),
				]);
				expect(added.code).toBe(0);
				const overlaid = specify(sb, ["workflow", "overlay", "add", OVERLAY]);
				expect(overlaid.code).toBe(0);
			};
			const runSpeckit = (sb: Sandbox) =>
				specify(sb, ["workflow", "run", "speckit", "--input", "spec=albums"]);

			const allowed = sandbox();
			install(allowed);
			writePolicy(allowed, "allow");
			const ran = runSpeckit(allowed);
			expect(ran.stdout).toContain("Status: completed");
			expect(trail(allowed)).toEqual(["specify", "plan", "tasks", "implement"]);

			const denied = sandbox();
			install(denied);
			writePolicy(denied, "deny");
			const failed = runSpeckit(denied);
			expect(failed.code).not.toBe(0);
			expect(failed.stdout).toContain("Status: failed");
			expect(trail(denied)).toEqual(["specify", "plan", "tasks"]);

			// No policy for speckit.implement: maina asks, the run pauses.
			const asked = sandbox();
			install(asked);
			const paused = runSpeckit(asked);
			expect(paused.stdout).toContain("Status: paused");
			expect(trail(asked)).toEqual(["specify", "plan", "tasks"]);
		},
	);

	live(
		"the overlay composes onto the stock speckit workflow from the catalog",
		() => {
			const sb = sandbox();
			expect(specify(sb, ["workflow", "add", "speckit"]).code).toBe(0);
			expect(specify(sb, ["workflow", "overlay", "add", OVERLAY]).code).toBe(0);
			const resolved = specify(sb, ["workflow", "resolve", "speckit"]);
			expect(resolved.code).toBe(0);
			const order = [...resolved.stdout.matchAll(/• ([a-z-]+): /g)].map(
				(m) => m[1],
			);
			expect(order.indexOf("maina-analyze")).toBe(order.indexOf("tasks") + 1);
			expect(order.indexOf("maina-verdict")).toBeLessThan(
				order.indexOf("implement"),
			);
			expect(order.indexOf("maina-route")).toBeLessThan(
				order.indexOf("implement"),
			);
		},
	);

	live(
		"installing the extension registers pre_tool_use with Claude Code and runs the Maina gate",
		() => {
			const reply =
				'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}';
			const sb = sandbox({ maina: stubMaina(reply), empty: true });
			const init = specify(sb, [
				"init",
				"--here",
				"--integration",
				"claude",
				"--script",
				"sh",
				"--ignore-agent-tools",
				"--force",
			]);
			expect(init.code).toBe(0);
			const added = specify(sb, ["extension", "add", "--dev", EXTENSION]);
			expect(added.code).toBe(0);

			const settings = JSON.parse(
				readFileSync(join(sb.dir, ".claude", "settings.json"), "utf8"),
			);
			const hooks = (settings.hooks.PreToolUse as readonly Yaml[]).flatMap(
				(entry) => entry.hooks as readonly Yaml[],
			);
			const gate = hooks.find((h) =>
				String(h.command).includes("speckit.maina.gate pre_tool_use"),
			);
			expect(gate).toBeDefined();

			// Run the hook command exactly as Claude Code would.
			const payload = hookPayload(
				"claude-code",
				"pre-tool-use.bash.input.json",
			);
			const result = run(["/bin/sh", "-c", String(gate?.command)], sb, {
				stdin: payload,
				env: { CLAUDE_PROJECT_DIR: sb.dir },
			});
			expect(result.code).toBe(0);
			expect(result.stdout.trim()).toBe(reply);
			expect(readFileSync(join(sb.bin, "args.txt"), "utf8")).toBe(
				"hook --host claude PreToolUse",
			);
		},
	);

	live(
		"installing the extension registers pre_tool_use with Codex and routes it to the Codex adapter",
		() => {
			const deny =
				'{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"no"}}';
			const sb = sandbox({ maina: stubMaina(deny, 2, "no"), empty: true });
			const init = specify(sb, [
				"init",
				"--here",
				"--integration",
				"codex",
				"--script",
				"sh",
				"--ignore-agent-tools",
				"--force",
			]);
			expect(init.code).toBe(0);
			const added = specify(sb, ["extension", "add", "--dev", EXTENSION]);
			expect(added.code).toBe(0);

			const config = Bun.TOML.parse(
				readFileSync(join(sb.dir, ".codex", "config.toml"), "utf8"),
			) as { hooks: Record<string, readonly Yaml[]> };
			const hooks = (config.hooks.PreToolUse ?? []).flatMap(
				(entry) => entry.hooks as readonly Yaml[],
			);
			const gate = hooks.find((h) =>
				String(h.command).includes("speckit.maina.gate pre_tool_use"),
			);
			expect(gate).toBeDefined();

			// Run the hook command as Codex would: a deny keeps exit 2.
			const result = run(["/bin/sh", "-c", String(gate?.command)], sb, {
				stdin: hookPayload("codex", "pre-tool-use.bash.input.json"),
			});
			expect(result.stdout.trim()).toBe(deny);
			expect(result.code).toBe(2);
			expect(readFileSync(join(sb.bin, "args.txt"), "utf8")).toBe(
				"hook --host codex PreToolUse",
			);
		},
	);
});
