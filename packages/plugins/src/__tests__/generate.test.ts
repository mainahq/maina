/**
 * Host plugin generation (v1 task 9.1, spec §5, Global Constraint 4).
 *
 * One definition (`../definition.ts`) generates every host's plugin package.
 * These tests pin what a host needs from it:
 *
 *   - each generated manifest, hooks file and MCP config validates against
 *     the host's schema, pinned under `../__fixtures__/<host>/`
 *   - nothing a host runs, and no skill, reaches for `bunx`, `npx` or a
 *     bare `maina`: the host starts the bundled launcher (task 2.3)
 *   - every hook is a documented event of the host (the runtime's #375
 *     contract fixtures), answered by the host's runtime adapter, runs
 *     `launch hook --host <host> <event>` (#487) and fails closed
 *   - one snapshot per host, and the committed `dist/` matches the generator
 */

import { afterAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { CLAUDE_HOOK_EVENTS } from "@mainahq/runtime/src/adapters/claude-code";
import {
	CODEX_HOOK_EVENTS,
	codexHooksConfig,
} from "@mainahq/runtime/src/adapters/codex";
import {
	CURSOR_HOOK_EVENTS,
	cursorHooksConfig,
} from "@mainahq/runtime/src/adapters/cursor";
import Ajv2020 from "ajv/dist/2020";
import { PLUGIN, type PluginDefinition } from "../definition";
import {
	type GeneratedFile,
	generate,
	HOSTS,
	type Host,
	type Sources,
} from "../generate";
import { loadSources } from "../sources";

const PACKAGE_DIR = join(import.meta.dir, "..", "..");
const FIXTURES_DIR = join(import.meta.dir, "..", "__fixtures__");
const DIST_DIR = join(PACKAGE_DIR, "dist");
const HOOK_CONTRACTS_DIR = join(
	PACKAGE_DIR,
	"..",
	"runtime",
	"src",
	"adapters",
	"__fixtures__",
);

interface FileContract {
	readonly path: string;
	readonly schema: string;
	readonly pointer?: string;
}

interface HostManifest {
	readonly host: string;
	readonly source: { readonly url: string; readonly retrieved: string };
	readonly hookContracts?: string;
	readonly files: readonly FileContract[];
}

const readJson = (path: string): unknown =>
	JSON.parse(readFileSync(path, "utf-8"));

const manifestOf = (host: Host): HostManifest =>
	readJson(join(FIXTURES_DIR, host, "manifest.json")) as HostManifest;

const sources: Sources = loadSources();
const generated = (host: Host): readonly GeneratedFile[] =>
	generate(host, sources);

const fileAt = (host: Host, path: string): GeneratedFile => {
	const file = generated(host).find((f) => f.path === path);
	if (file === undefined) throw new Error(`${host}: no ${path}`);
	return file;
};

const jsonAt = (host: Host, path: string): Record<string, unknown> =>
	JSON.parse(fileAt(host, path).content) as Record<string, unknown>;

function makeAjv(): Ajv2020 {
	const ajv = new Ajv2020({ allErrors: true, strict: true });
	// Provenance annotation carried by every schema; no validation semantics.
	ajv.addKeyword({
		keyword: "x-source",
		metaSchema: {
			type: "object",
			required: ["url", "retrieved"],
			properties: {
				url: { type: "string" },
				retrieved: { type: "string" },
			},
		},
	});
	return ajv;
}

/** The value at a JSON pointer such as `/extensions/com.openai`. */
function atPointer(value: unknown, pointer: string | undefined): unknown {
	if (pointer === undefined) return value;
	return pointer
		.split("/")
		.slice(1)
		.map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
		.reduce<unknown>(
			(node, key) =>
				typeof node === "object" && node !== null
					? (node as Record<string, unknown>)[key]
					: undefined,
			value,
		);
}

// ── Hooks, read back from each host's hooks file ──────────────────────────

interface RegisteredHook {
	readonly event: string;
	readonly command: string;
	readonly matcher?: string;
	readonly failClosed?: boolean;
	readonly async?: boolean;
}

type Group = {
	matcher?: string;
	hooks: { command: string; async?: boolean }[];
};
type CursorEntry = { command: string; failClosed?: boolean; matcher?: string };

function registeredHooks(host: Host): readonly RegisteredHook[] {
	const path = "hooks/hooks.json";
	if (!generated(host).some((f) => f.path === path)) return [];
	const hooks = jsonAt(host, path).hooks as Record<string, unknown[]>;
	return Object.entries(hooks).flatMap(([event, entries]) =>
		host === "cursor"
			? (entries as CursorEntry[]).map((e) => ({ event, ...e }))
			: (entries as Group[]).flatMap((group) =>
					group.hooks.map((h) => ({
						event,
						command: h.command,
						matcher: group.matcher,
						async: h.async,
					})),
				),
	);
}

/** Each host's documented hook events: its #375 contract fixtures. */
function documentedEvents(host: Host): ReadonlySet<string> {
	const folder = manifestOf(host).hookContracts;
	if (folder === undefined) return new Set();
	const contract = readJson(join(HOOK_CONTRACTS_DIR, folder, "manifest.json"));
	const fixtures = (contract as { fixtures: { event: string }[] }).fixtures;
	return new Set(fixtures.map((f) => f.event));
}

/** The events each host's runtime adapter answers. */
const ANSWERED: Readonly<Record<string, ReadonlySet<string>>> = {
	claude: CLAUDE_HOOK_EVENTS,
	codex: CODEX_HOOK_EVENTS,
	cursor: CURSOR_HOOK_EVENTS,
};

/** How each host's hook commands name the plugin root. */
const PLUGIN_ROOT: Readonly<Record<string, string>> = {
	claude: `"\${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh"`,
	codex: `\${PLUGIN_ROOT}/launcher/launch.sh`,
	cursor: "./launcher/launch.sh",
};

/** Native events that gate an action; the rest observe. */
const GATES: ReadonlySet<string> = new Set([
	"PreToolUse",
	"PermissionRequest",
	"preToolUse",
	"beforeShellExecution",
	"beforeMCPExecution",
]);

const HOOKED_HOSTS: readonly Host[] = ["claude", "codex", "cursor"];

// ── Manifests validate against the host schemas ───────────────────────────

describe("host schemas (fixtures)", () => {
	for (const host of HOSTS) {
		describe(host, () => {
			const manifest = manifestOf(host);

			test("has a manifest with the source doc URL and retrieval date", () => {
				expect(manifest.host).toBe(host);
				expect(manifest.source.url).toMatch(/^https:\/\//);
				expect(manifest.source.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			});

			test("every schema names its source", () => {
				const dir = join(FIXTURES_DIR, host, "schemas");
				for (const name of readdirSync(dir)) {
					const schema = readJson(join(dir, name)) as Record<string, unknown>;
					const source = schema["x-source"] as HostManifest["source"];
					expect(source?.url).toMatch(/^https:\/\//);
					expect(source?.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				}
			});

			for (const contract of manifest.files) {
				const where = contract.pointer ?? "";
				test(`${contract.path}${where} validates against ${contract.schema}`, () => {
					const ajv = makeAjv();
					const validate = ajv.compile(
						readJson(join(FIXTURES_DIR, host, contract.schema)) as object,
					);
					const value = atPointer(
						JSON.parse(fileAt(host, contract.path).content),
						contract.pointer,
					);
					const ok = validate(value);
					expect(validate.errors ?? []).toEqual([]);
					expect(ok).toBe(true);
				});
			}
		});
	}

	test("the schemas reject a manifest a host would not load", () => {
		const ajv = makeAjv();
		const validate = ajv.compile(
			readJson(
				join(FIXTURES_DIR, "claude", "schemas/plugin.schema.json"),
			) as object,
		);
		expect(validate({ name: "Maina Plugin", version: "1" })).toBe(false);
		expect(validate.errors?.map((e) => e.keyword)).toContain("pattern");
	});
});

// ── No package-manager spawns, no PATH lookups ────────────────────────────

/** A command that starts `maina` from PATH, or runs a package manager. */
const BARE_MAINA = /(?:^|[\s;&|(])maina(?:\s|$)/;
const PACKAGE_RUNNER = /\b(?:bunx|npx)\b/;

/** Every string a host runs: `command` values and `args` items. */
function commandStrings(value: unknown, key = ""): readonly string[] {
	if (typeof value === "string")
		return key === "command" || key === "args" ? [value] : [];
	if (Array.isArray(value))
		return value.flatMap((item) => commandStrings(item, key));
	if (typeof value === "object" && value !== null)
		return Object.entries(value).flatMap(([k, v]) => commandStrings(v, k));
	return [];
}

/** Inline code spans and fenced code lines of a Markdown document. */
function codeIn(markdown: string): readonly string[] {
	const fenced = [...markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].flatMap(
		(m) => (m[1] ?? "").split("\n"),
	);
	const inline = [...markdown.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
	return [...fenced, ...inline];
}

describe("no bunx, npx or bare maina", () => {
	for (const host of HOSTS) {
		test(host, () => {
			const offenders = generated(host).flatMap((file) => {
				const found: string[] = [];
				if (PACKAGE_RUNNER.test(file.content)) found.push("bunx/npx");
				if (file.path.endsWith(".json")) {
					for (const cmd of commandStrings(JSON.parse(file.content)))
						if (BARE_MAINA.test(cmd)) found.push(cmd);
				}
				if (file.path.endsWith(".md")) {
					for (const code of codeIn(file.content))
						if (BARE_MAINA.test(code)) found.push(code);
				}
				return found.map((what) => `${file.path}: ${what}`);
			});
			expect(offenders).toEqual([]);
		});
	}

	test("the check catches each form", () => {
		expect(BARE_MAINA.test("maina hook PreToolUse")).toBe(true);
		expect(PACKAGE_RUNNER.test("npx @mainahq/cli setup")).toBe(true);
		expect(
			codeIn("run `maina verify` now").some((c) => BARE_MAINA.test(c)),
		).toBe(true);
		expect(BARE_MAINA.test("./launcher/launch.sh cli verify")).toBe(false);
	});
});

// ── Hooks ─────────────────────────────────────────────────────────────────

describe("hooks", () => {
	for (const host of HOOKED_HOSTS) {
		describe(host, () => {
			const hooks = registeredHooks(host);

			test("registers hooks", () => {
				expect(hooks.length).toBeGreaterThan(0);
			});

			test("uses only the host's documented events, each answered by its adapter", () => {
				const documented = documentedEvents(host);
				expect(documented.size).toBeGreaterThan(0);
				for (const hook of hooks) {
					expect(documented.has(hook.event)).toBe(true);
					expect(ANSWERED[host]?.has(hook.event)).toBe(true);
				}
			});

			test("every hook runs the bundled launcher: launch hook --host <host> <event>", () => {
				for (const hook of hooks) {
					expect(hook.command).toBe(
						`${PLUGIN_ROOT[host]} hook --host ${host} ${hook.event}`,
					);
				}
			});

			test("gates fail closed", () => {
				const gates = hooks.filter((h) => GATES.has(h.event));
				expect(gates.length).toBeGreaterThan(0);
				for (const hook of hooks) {
					// An async hook never blocks, on any host.
					expect(hook.async).toBeUndefined();
					if (host === "cursor") {
						// Cursor fails open unless failClosed is set; observers stay open
						// so a crash in them does not hold up the session.
						expect(hook.failClosed).toBe(
							GATES.has(hook.event) ? true : undefined,
						);
					} else {
						// Claude Code and Codex have no fail-closed setting: the launcher
						// answers a deny or an ask itself when the runtime cannot.
						expect(hook.failClosed).toBeUndefined();
					}
				}
			});
		});
	}

	test("Claude Code gates every tool its adapter maps, and nothing else", () => {
		const tools = registeredHooks("claude")
			.filter((h) => GATES.has(h.event))
			.map((h) => h.matcher);
		const matcher = new RegExp(`^(?:${tools[0]})$`);
		for (const tool of [
			"Bash",
			"Write",
			"Edit",
			"MultiEdit",
			"NotebookEdit",
			"Read",
			"Grep",
			"Glob",
			"WebFetch",
			"mcp__github__create_issue",
		]) {
			expect(matcher.test(tool)).toBe(true);
		}
		expect(matcher.test("TodoWrite")).toBe(false);
		expect(new Set(tools).size).toBe(1);
	});

	test("Codex hooks match the Codex adapter's registration", () => {
		expect(jsonAt("codex", "hooks/hooks.json")).toEqual(
			codexHooksConfig(`${PLUGIN_ROOT.codex} hook`).config as unknown as Record<
				string,
				unknown
			>,
		);
	});

	test("Cursor hooks match the Cursor adapter's registration", () => {
		expect(jsonAt("cursor", "hooks/hooks.json")).toEqual(
			cursorHooksConfig(`${PLUGIN_ROOT.cursor} hook`)
				.config as unknown as Record<string, unknown>,
		);
	});

	test("every hook in the definition is registered on each host", () => {
		const expected: Readonly<Record<string, readonly string[]>> = {
			claude: ["SessionStart", "PreToolUse", "PermissionRequest", "Stop"],
			codex: ["SessionStart", "PreToolUse", "PermissionRequest", "Stop"],
			cursor: [
				"sessionStart",
				"preToolUse",
				"beforeShellExecution",
				"beforeMCPExecution",
				"afterFileEdit",
				"stop",
			],
		};
		for (const host of HOOKED_HOSTS) {
			expect(registeredHooks(host).map((h) => h.event)).toEqual([
				...(expected[host] ?? []),
			]);
		}
	});

	test("Agent Plugins has no hooks: the 1.0 core defines none", () => {
		expect(registeredHooks("agent-plugins")).toEqual([]);
		expect(
			generated("agent-plugins").some((f) => f.path.startsWith("hooks/")),
		).toBe(false);
	});

	const scratch = mkdtempSync(join(tmpdir(), "maina-plugins-340-"));
	afterAll(() => rmSync(scratch, { recursive: true, force: true }));

	test.skipIf(process.platform === "win32")(
		"the launcher accepts every generated hook command and fails closed without a runtime",
		async () => {
			for (const host of HOOKED_HOSTS) {
				const root = join(DIST_DIR, host);
				for (const hook of registeredHooks(host)) {
					const proc = Bun.spawn(["/bin/sh", "-c", hook.command], {
						cwd: root,
						env: {
							PATH: "/usr/bin:/bin",
							HOME: scratch,
							CLAUDE_PLUGIN_ROOT: root,
							PLUGIN_ROOT: root,
							PLUGIN_DATA: join(scratch, host),
						},
						stdin: "ignore",
						stdout: "pipe",
						stderr: "pipe",
					});
					const [stdout, exitCode] = await Promise.all([
						new Response(proc.stdout).text(),
						proc.exited,
					]);
					const answer = JSON.stringify(JSON.parse(stdout));
					expect([0, 2]).toContain(exitCode);
					if (GATES.has(hook.event)) {
						// Never an allow: an ask where the host enforces it, else a deny.
						// A PermissionRequest runs only when the host is about to
						// prompt, so no decision (`{}`) keeps the prompt: the ask.
						expect(answer).not.toMatch(/"allow"/);
						if (hook.event === "PermissionRequest") expect(answer).toBe("{}");
						else expect(answer).toMatch(/"(?:ask|deny)"/);
					}
				}
			}
		},
		30_000,
	);
});

// ── MCP, skills, launcher ─────────────────────────────────────────────────

const MCP_FILE: Readonly<Record<Host, string>> = {
	claude: ".mcp.json",
	cursor: "mcp.json",
	codex: "mcp.json",
	"agent-plugins": "mcp.json",
};

describe("MCP config", () => {
	for (const host of HOSTS) {
		test(`${host}: the maina server is the bundled launcher in mcp mode`, () => {
			const servers = jsonAt(host, MCP_FILE[host]).mcpServers as Record<
				string,
				{ command: string; args: string[] }
			>;
			const server = servers[PLUGIN.mcpServer];
			expect(server?.command).toMatch(/launcher\/launch\.sh$/);
			expect(server?.args).toEqual(["mcp"]);
		});
	}
});

describe("skills and launcher", () => {
	for (const host of HOSTS) {
		test(`${host}: ships every skill in the definition, named after its folder`, () => {
			for (const name of PLUGIN.skills) {
				const skill = fileAt(host, `skills/${name}/SKILL.md`).content;
				expect(skill).toMatch(new RegExp(`^---\\nname: ${name}\\n`));
			}
		});

		test(`${host}: bundles the launcher, with launch.sh executable`, () => {
			const files = generated(host);
			const launch = files.find((f) => f.path === "launcher/launch.sh");
			expect(launch?.executable).toBe(true);
			expect(files.some((f) => f.path === "launcher/launch.ps1")).toBe(true);
			expect(files.some((f) => f.path === "launcher/manifest.json")).toBe(true);
		});
	}

	test("skill CLI references point at the launcher's cli mode", () => {
		const claude = fileAt("claude", "skills/tdd/SKILL.md").content;
		expect(claude).toContain(
			`\`"\${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh" cli verify\``,
		);
		expect(claude).not.toContain("relative to this skill's folder");
		// Cursor and Agent Plugins expand no plugin-root variable in a skill,
		// so the launcher is named by its path from the skill's folder.
		for (const host of ["cursor", "codex", "agent-plugins"] as const) {
			const skill = fileAt(host, "skills/tdd/SKILL.md").content;
			expect(skill).toContain("`../../launcher/launch.sh cli verify`");
			expect(skill).toMatch(
				/^---\n[\s\S]*?\n---\n\n> This plugin bundles the maina CLI: .*relative to this skill's folder\.\n/,
			);
		}
	});

	test("commands and agents in the definition reach the hosts that load them", () => {
		const definition: PluginDefinition = {
			...PLUGIN,
			commands: [
				{ name: "gate", description: "Gate it", body: "Run the gate." },
			],
			agents: [
				{ name: "reviewer", description: "Reviews diffs", body: "Review it." },
			],
		};
		for (const host of ["claude", "cursor"] as const) {
			const paths = generate(host, sources, definition).map((f) => f.path);
			expect(paths).toContain("commands/gate.md");
			expect(paths).toContain("agents/reviewer.md");
		}
		expect(
			generate("claude", sources, definition).find(
				(f) => f.path === "commands/gate.md",
			)?.content,
		).toBe("---\ndescription: Gate it\n---\n\nRun the gate.\n");
	});
});

// ── Snapshots and the committed dist ──────────────────────────────────────

describe("snapshots", () => {
	for (const host of HOSTS) {
		test(host, () => {
			const files = generated(host);
			const config = Object.fromEntries(
				files
					.filter(
						(f) => f.path.endsWith(".json") && !f.path.startsWith("launcher/"),
					)
					.map((f) => [f.path, JSON.parse(f.content)]),
			);
			expect({ paths: files.map((f) => f.path), config }).toMatchSnapshot();
		});
	}
});

function listFiles(dir: string): readonly string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		return statSync(full).isDirectory() ? listFiles(full) : [full];
	});
}

describe("committed dist", () => {
	for (const host of HOSTS) {
		test(`dist/${host} is what the generator writes (run \`bun run plugins:generate\`)`, () => {
			const dir = join(DIST_DIR, host);
			expect(existsSync(dir)).toBe(true);
			const onDisk = listFiles(dir)
				.map((full) => relative(dir, full).split(sep).join("/"))
				.sort();
			const files = generated(host);
			expect(onDisk).toEqual(files.map((f) => f.path).sort());
			for (const file of files) {
				const full = join(dir, file.path);
				expect(readFileSync(full, "utf-8")).toBe(file.content);
				if (process.platform !== "win32") {
					expect((statSync(full).mode & 0o111) !== 0).toBe(file.executable);
				}
			}
		});
	}
});
