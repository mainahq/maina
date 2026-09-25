/**
 * Launcher files and the fail-closed hook output (v1 task 2.3; ADR 0045;
 * mainahq/maina#475): the launchers stay small and dependency-free, the
 * committed manifest is in the generated layout, and the fail-closed output
 * that both launchers print is valid for every host's pinned hook schema and
 * never lets an action run unconfirmed on the host it was registered for.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { renderManifest } from "../../build/standalone";
import { failClosedHook } from "../../src/standalone/hook-fallback";
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
	const HOSTS = [
		["claude-code", "claude"],
		["cursor", "cursor"],
		["codex", "codex"],
	] as const;

	test("validates against every host's output schema", () => {
		let checked = 0;
		for (const [dir, host] of HOSTS) {
			const manifest = JSON.parse(
				readFileSync(join(fixtures, dir, "manifest.json"), "utf-8"),
			) as { fixtures: readonly FixtureEntry[] };
			const outputs = new Map<string, string>();
			for (const f of manifest.fixtures) {
				if (f.direction === "output") outputs.set(f.event, f.schema);
			}
			for (const [event, schema] of outputs) {
				const validate = ajv.compile(
					JSON.parse(readFileSync(join(fixtures, dir, schema), "utf-8")),
				);
				const output = JSON.parse(failClosedHook(host, event, "timeout").line);
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

	test("Claude Code asks on PreToolUse", () => {
		const out = failClosedHook("claude", "PreToolUse", "timeout");
		expect(out.exitCode).toBe(0);
		expect(out.stderr).toBe("");
		expect(JSON.parse(out.line)).toMatchObject({
			hookSpecificOutput: { permissionDecision: "ask" },
		});
	});

	test("Codex denies on PreToolUse, with exit 2 and the reason on stderr", () => {
		// Codex fails a PreToolUse hook that asks and runs the tool anyway.
		const out = failClosedHook("codex", "PreToolUse", "timeout");
		const parsed = JSON.parse(out.line) as {
			hookSpecificOutput: { permissionDecisionReason: string };
		};
		expect(parsed).toMatchObject({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
			},
		});
		expect(out.exitCode).toBe(2);
		expect(out.stderr).toBe(
			`${parsed.hookSpecificOutput.permissionDecisionReason}\n`,
		);
		expect(out.stderr).toContain("timeout");
	});

	test("no Codex fail-closed output ever carries ask", () => {
		for (const event of [
			"PreToolUse",
			"PermissionRequest",
			"PostToolUse",
			"SessionStart",
			"Stop",
		]) {
			expect(failClosedHook("codex", event, "timeout").line).not.toContain(
				'"ask"',
			);
		}
	});

	test("an ambiguous host gets the answer that fails closed in both", () => {
		// Claude Code and Codex share PascalCase events: deny is closed in both.
		expect(failClosedHook(undefined, "PreToolUse", "host_ambiguous")).toEqual(
			failClosedHook("codex", "PreToolUse", "host_ambiguous"),
		);
		expect(failClosedHook(undefined, "SessionStart", "host_ambiguous")).toEqual(
			failClosedHook("claude", "SessionStart", "host_ambiguous"),
		);
	});

	test("Cursor asks where it enforces ask and denies on preToolUse (#469)", () => {
		for (const event of ["beforeShellExecution", "beforeMCPExecution"]) {
			const out = failClosedHook("cursor", event, "timeout");
			expect(out.exitCode).toBe(0);
			expect(JSON.parse(out.line)).toMatchObject({ permission: "ask" });
		}
		const pre = failClosedHook("cursor", "preToolUse", "timeout");
		expect(pre.exitCode).toBe(2);
		expect(JSON.parse(pre.line)).toMatchObject({ permission: "deny" });
		expect(pre.stderr).toContain("timeout");
		// Cursor's events are Cursor's, whatever host was named.
		expect(failClosedHook(undefined, "preToolUse", "timeout")).toEqual(pre);
	});

	test("an unknown event gets an empty object, never a decision", () => {
		for (const host of ["claude", "codex", "cursor", undefined] as const) {
			expect(failClosedHook(host, "SomethingNew", "timeout")).toEqual({
				line: "{}",
				stderr: "",
				exitCode: 0,
			});
		}
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
