/**
 * Launcher files and the fail-closed hook output (v1 task 2.3; ADR 0045):
 * the launchers stay small and dependency-free, the committed manifest is in
 * the generated layout, and the fail-closed output that both launchers print
 * is valid for every host's pinned hook schema.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { renderManifest } from "../../build/standalone";
import { failClosedHookOutput } from "../../src/standalone/hook-fallback";
import { LAUNCHER_DIR } from "./fixture";

describe("fail-closed hook output", () => {
	type FixtureEntry = Readonly<{
		schema: string;
		event: string;
		direction: string;
	}>;
	const ajv = new Ajv({ strict: false });
	const fixtures = join(
		import.meta.dir,
		"..",
		"..",
		"src",
		"adapters",
		"__fixtures__",
	);

	test("validates against every host's output schema", () => {
		let checked = 0;
		for (const host of ["claude-code", "cursor", "codex"]) {
			const manifest = JSON.parse(
				readFileSync(join(fixtures, host, "manifest.json"), "utf-8"),
			) as { fixtures: readonly FixtureEntry[] };
			const outputs = new Map<string, string>();
			for (const f of manifest.fixtures) {
				if (f.direction === "output") outputs.set(f.event, f.schema);
			}
			for (const [event, schema] of outputs) {
				const validate = ajv.compile(
					JSON.parse(readFileSync(join(fixtures, host, schema), "utf-8")),
				);
				const output = JSON.parse(failClosedHookOutput(event, "timeout"));
				expect({
					host,
					event,
					ok: validate(output),
					errors: validate.errors,
				}).toEqual({
					host,
					event,
					ok: true,
					errors: null,
				});
				checked++;
			}
		}
		expect(checked).toBeGreaterThanOrEqual(15);
	});

	test("an unknown event gets an empty object, never a decision", () => {
		expect(failClosedHookOutput("SomethingNew", "timeout")).toBe("{}");
	});
});

describe("launcher files", () => {
	test("launch.sh is small and uses no runtime or JSON tool", () => {
		const script = readFileSync(join(LAUNCHER_DIR, "launch.sh"), "utf-8");
		expect(script.startsWith("#!/bin/sh\n")).toBe(true);
		expect(Buffer.byteLength(script)).toBeLessThan(16 * 1024);
		expect(script).not.toMatch(/\b(bun|bunx|node|npx|jq|python3?|perl)\b/);
	});

	test("launch.ps1 is small and needs no module", () => {
		const script = readFileSync(join(LAUNCHER_DIR, "launch.ps1"), "utf-8");
		expect(Buffer.byteLength(script)).toBeLessThan(16 * 1024);
		expect(script).not.toMatch(/Import-Module|Install-Module|\bbun\b|\bnode\b/);
	});

	test("the committed manifest is in the canonical generated format", () => {
		const path = join(LAUNCHER_DIR, "manifest.json");
		const raw = readFileSync(path, "utf-8");
		expect(raw).toBe(renderManifest(JSON.parse(raw)));
	});

	test("no private key is ever committed next to the launcher", () => {
		for (const name of ["release.key", "release.pem", "private.pem"]) {
			expect(existsSync(join(LAUNCHER_DIR, name))).toBe(false);
		}
	});
});
