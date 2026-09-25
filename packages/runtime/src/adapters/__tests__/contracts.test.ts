/**
 * Host hook contract tests (FR-GATE-7).
 *
 * Every host adapter (Claude Code, Cursor, Codex) normalises the host's hook
 * payloads and renders decisions back in the host's wire format. These tests
 * pin that wire format: each host folder under `__fixtures__/` holds the host's
 * documented hook schemas (JSON Schema, with the source doc URL and retrieval
 * date) plus recorded sample inputs and valid outputs. Each fixture must
 * validate against its schema, and each negative fixture must be rejected, so
 * a host-side contract change shows up here before it reaches an adapter.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import Ajv from "ajv";

const FIXTURES_DIR = join(import.meta.dir, "..", "__fixtures__");

type Direction = "input" | "output";

interface SourceRef {
	readonly url: string;
	readonly retrieved: string;
}

interface FixtureEntry {
	readonly file: string;
	readonly schema: string;
	readonly event: string;
	readonly direction: Direction;
	readonly covers: string;
	readonly origin: "captured" | "docs" | "docs-partial";
	readonly notes?: string;
}

interface InvalidEntry {
	readonly file: string;
	readonly schema: string;
	readonly why: string;
	/** The ajv error that proves the fixture is rejected for the stated reason. */
	readonly error: { readonly keyword: string; readonly instancePath: string };
}

interface Manifest {
	readonly host: string;
	readonly source: SourceRef & { readonly hostVersion?: string };
	readonly fixtures: readonly FixtureEntry[];
	readonly invalid: readonly InvalidEntry[];
}

/** Logical slots every host must cover (host-neutral names). */
const COMMON_SLOTS: readonly string[] = [
	"session-start:input",
	"session-start:output",
	"pre-tool.shell:input",
	"pre-tool.file-write:input",
	"pre-tool.mcp:input",
	"pre-tool:output",
	"post-tool:input",
	"post-tool:output",
	"stop:input",
	"stop:output",
];

/** Native host events that must be covered explicitly (event:direction). */
const HOST_EVENTS: Readonly<Record<string, readonly string[]>> = {
	"claude-code": [
		"SessionStart:input",
		"PreToolUse:input",
		"PreToolUse:output",
		"PostToolUse:input",
		"Stop:input",
	],
	cursor: [
		"sessionStart:input",
		"beforeShellExecution:input",
		"beforeShellExecution:output",
		"preToolUse:input",
		"preToolUse:output",
		"stop:input",
	],
	codex: [
		"SessionStart:input",
		"PreToolUse:input",
		"PreToolUse:output",
		"PermissionRequest:input",
		"PermissionRequest:output",
		"Stop:input",
	],
};

const HOSTS = Object.keys(HOST_EVENTS);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function loadManifest(host: string): Manifest | undefined {
	const path = join(FIXTURES_DIR, host, "manifest.json");
	return existsSync(path) ? (readJson(path) as Manifest) : undefined;
}

function listJsonFiles(dir: string): readonly string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) return listJsonFiles(full);
		return name.endsWith(".json") ? [full] : [];
	});
}

function makeAjv(): Ajv {
	// Nullable fields use `type: ["string", "null"]`, as the hosts' docs do, and
	// conditional rules (`if`/`anyOf` + `required`) name properties declared at
	// the top level, which ajv's strictRequired check would reject.
	const ajv = new Ajv({
		allErrors: true,
		strict: true,
		strictRequired: false,
		allowUnionTypes: true,
	});
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

function isHttpsUrl(value: unknown): boolean {
	return typeof value === "string" && value.startsWith("https://");
}

for (const host of HOSTS) {
	describe(`${host} hook contract`, () => {
		const hostDir = join(FIXTURES_DIR, host);
		const manifest = loadManifest(host);

		test("has a manifest with the source doc URL and retrieval date", () => {
			expect(manifest).toBeDefined();
			expect(manifest?.host).toBe(host);
			expect(isHttpsUrl(manifest?.source.url)).toBe(true);
			expect(manifest?.source.retrieved ?? "").toMatch(ISO_DATE);
		});

		if (!manifest) return;

		const ajv = makeAjv();
		const schemaPaths = [
			...new Set([
				...manifest.fixtures.map((f) => f.schema),
				...manifest.invalid.map((f) => f.schema),
			]),
		];

		test("every schema records its source URL and retrieval date", () => {
			for (const rel of schemaPaths) {
				const path = join(hostDir, rel);
				expect(existsSync(path)).toBe(true);
				const schema = readJson(path) as Record<string, unknown>;
				const source = schema["x-source"] as SourceRef | undefined;
				expect({ rel, url: isHttpsUrl(source?.url) }).toEqual({
					rel,
					url: true,
				});
				expect(source?.retrieved ?? "").toMatch(ISO_DATE);
			}
		});

		test("covers session start, pre-tool (shell, file write, MCP), post-tool and stop", () => {
			const covered = new Set(
				manifest.fixtures.map((f) => `${f.covers}:${f.direction}`),
			);
			const missing = COMMON_SLOTS.filter((slot) => !covered.has(slot));
			expect(missing).toEqual([]);
		});

		test("covers the host's native gate events", () => {
			const covered = new Set(
				manifest.fixtures.map((f) => `${f.event}:${f.direction}`),
			);
			const required = HOST_EVENTS[host] ?? [];
			const missing = required.filter((ev) => !covered.has(ev));
			expect(missing).toEqual([]);
		});

		test("has no unreferenced JSON files in the fixture folder", () => {
			const referenced = new Set([
				"manifest.json",
				...schemaPaths,
				...manifest.fixtures.map((f) => f.file),
				...manifest.invalid.map((f) => f.file),
			]);
			const orphans = listJsonFiles(hostDir)
				.map((p) => relative(hostDir, p))
				.filter((rel) => !referenced.has(rel));
			expect(orphans).toEqual([]);
		});

		for (const fixture of manifest.fixtures) {
			test(`${fixture.file} is a valid ${fixture.event} ${fixture.direction}`, () => {
				const schema = readJson(join(hostDir, fixture.schema)) as object;
				const data = readJson(join(hostDir, fixture.file));
				const validate = ajv.compile(schema);
				const ok = validate(data);
				expect({
					file: fixture.file,
					errors: ok ? null : validate.errors,
				}).toEqual({
					file: fixture.file,
					errors: null,
				});
				if (fixture.direction === "input") {
					const eventName = (data as Record<string, unknown>).hook_event_name;
					expect(eventName).toBe(fixture.event);
				}
			});
		}

		for (const bad of manifest.invalid) {
			test(`${bad.file} is rejected (${bad.why})`, () => {
				const schema = readJson(join(hostDir, bad.schema)) as object;
				const data = readJson(join(hostDir, bad.file));
				const validate = ajv.compile(schema);
				expect(validate(data)).toBe(false);
				const errors = (validate.errors ?? []).map((e) => ({
					keyword: e.keyword,
					instancePath: e.instancePath,
				}));
				expect(errors).toContainEqual(bad.error);
			});
		}
	});
}
