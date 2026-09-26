/**
 * Hook routing (mainahq/maina#475): `maina hook [--host <host>] <event>`
 * picks the adapter by the host the hook was registered for. Claude Code and
 * Codex share their event names but not their answers (Codex runs a tool
 * whose PreToolUse hook asks), so a PascalCase event with no host is
 * ambiguous and fails closed; Cursor's camelCase events are its own.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failClosedHook } from "../standalone/hook-fallback";
import { routeHook } from "../standalone/hook-route";

describe("routeHook", () => {
	test("an explicit host routes each of its events to its adapter", () => {
		expect(routeHook(["--host", "codex", "PreToolUse"])).toEqual({
			type: "run",
			host: "codex",
			event: "PreToolUse",
		});
		expect(routeHook(["--host", "claude", "PreToolUse"])).toEqual({
			type: "run",
			host: "claude",
			event: "PreToolUse",
		});
		expect(routeHook(["--host", "cursor", "preToolUse"])).toEqual({
			type: "run",
			host: "cursor",
			event: "preToolUse",
		});
		for (const event of [
			"SessionStart",
			"PermissionRequest",
			"PostToolUse",
			"Stop",
		]) {
			expect(routeHook(["--host", "codex", event])).toEqual({
				type: "run",
				host: "codex",
				event,
			});
		}
	});

	test("without a host, Cursor's camelCase events still go to Cursor", () => {
		for (const event of ["beforeShellExecution", "preToolUse", "stop"]) {
			expect(routeHook([event])).toEqual({
				type: "run",
				host: "cursor",
				event,
			});
		}
	});

	test("without a host, a PascalCase event is ambiguous and fails closed", () => {
		for (const event of ["PreToolUse", "PermissionRequest", "SessionStart"]) {
			expect(routeHook([event])).toEqual({
				type: "fail-closed",
				host: undefined,
				event,
				cause: "host_ambiguous",
			});
		}
	});

	test("an unknown or missing host fails closed, never runs an adapter", () => {
		expect(routeHook(["--host", "vscode", "PreToolUse"])).toEqual({
			type: "fail-closed",
			host: undefined,
			event: "PreToolUse",
			cause: "unknown_host",
		});
		expect(routeHook(["--host", "", "PreToolUse"])).toEqual({
			type: "fail-closed",
			host: undefined,
			event: "PreToolUse",
			cause: "unknown_host",
		});
		expect(routeHook(["--host"])).toEqual({
			type: "fail-closed",
			host: undefined,
			event: "",
			cause: "unknown_host",
		});
	});

	test("an event the host does not answer fails closed for that host", () => {
		expect(routeHook(["--host", "codex", "preToolUse"])).toEqual({
			type: "fail-closed",
			host: "codex",
			event: "preToolUse",
			cause: "gate_not_active",
		});
		expect(routeHook(["--host", "cursor", "PreToolUse"])).toEqual({
			type: "fail-closed",
			host: "cursor",
			event: "PreToolUse",
			cause: "gate_not_active",
		});
		expect(routeHook(["SomethingNew"])).toEqual({
			type: "fail-closed",
			host: undefined,
			event: "SomethingNew",
			cause: "gate_not_active",
		});
	});
});

// ── The standalone entry's hook mode ─────────────────────────────────────

const MAIN = join(import.meta.dir, "..", "standalone", "main.ts");

const homes: string[] = [];
afterAll(() => {
	for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/** A temp HOME: hooks record to ~/.maina/retention.jsonl (FR-RET-7). */
function tempHome(): string {
	const home = mkdtempSync(join(tmpdir(), "maina-hook-home-"));
	homes.push(home);
	return home;
}

async function hook(
	args: readonly string[],
	stdin: string,
	home: string = tempHome(),
) {
	const proc = Bun.spawn([process.execPath, MAIN, "hook", ...args], {
		env: { ...process.env, HOME: home },
		stdin: new TextEncoder().encode(stdin),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

describe("maina hook", () => {
	test("--host codex answers through the Codex adapter: an ask is a deny", async () => {
		// A payload with no hook_event_name is malformed, which asks.
		const out = await hook(["--host", "codex", "PreToolUse"], "{}");
		expect(out.exitCode).toBe(2);
		expect(JSON.parse(out.stdout)).toMatchObject({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
			},
		});
		expect(out.stderr).toContain("no hook_event_name");
	});

	test("--host claude answers through the Claude Code adapter: it asks", async () => {
		const out = await hook(["--host", "claude", "PreToolUse"], "");
		expect(out.exitCode).toBe(0);
		expect(JSON.parse(out.stdout)).toMatchObject({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "ask",
			},
		});
	});

	test("no host for a PascalCase event prints the fail-closed deny", async () => {
		const out = await hook(["PreToolUse"], "{}");
		const expected = failClosedHook(undefined, "PreToolUse", "host_ambiguous");
		expect(out.stdout).toBe(`${expected.line}\n`);
		expect(out.stderr).toBe(expected.stderr);
		expect(out.exitCode).toBe(2);
	});

	test("a SessionStart is recorded in the local retention history", async () => {
		const home = tempHome();
		const start = JSON.stringify({
			session_id: "s-352",
			hook_event_name: "SessionStart",
			source: "startup",
		});
		const out = await hook(["--host", "claude", "SessionStart"], start, home);
		expect(out.exitCode).toBe(0);
		const log = readFileSync(join(home, ".maina", "retention.jsonl"), "utf-8");
		expect(JSON.parse(log)).toMatchObject({
			kind: "session",
			host: "claude-code",
		});
	});

	test("an unknown host prints the fail-closed deny", async () => {
		const out = await hook(["--host", "vscode", "PreToolUse"], "{}");
		expect(out.stdout).toBe(
			`${failClosedHook(undefined, "PreToolUse", "unknown_host").line}\n`,
		);
		expect(out.exitCode).toBe(2);
	});
});
