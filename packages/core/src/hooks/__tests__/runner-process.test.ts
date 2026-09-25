/**
 * Issue #433: lifecycle hooks run through a `ProcessPort`, with the JSON
 * context on stdin and the repo root as cwd.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeProcess } from "../../ports/testing";
import { executeHook, type HookContext, runHooks } from "../runner";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function setup(): { mainaDir: string; hookPath: string; context: HookContext } {
	const root = mkdtempSync(join(tmpdir(), "maina-hooks-proc-"));
	dirs.push(root);
	const mainaDir = join(root, ".maina");
	mkdirSync(join(mainaDir, "hooks"), { recursive: true });
	const hookPath = join(mainaDir, "hooks", "pre-commit.sh");
	writeFileSync(hookPath, "#!/bin/sh\nexit 0\n");
	return {
		mainaDir,
		hookPath,
		context: {
			event: "pre-commit",
			repoRoot: root,
			mainaDir,
			timestamp: "2026-09-25T00:00:00.000Z",
		},
	};
}

describe("hooks over an injected ProcessPort", () => {
	test("executeHook pipes the context on stdin and runs in the repo root", async () => {
		const { hookPath, context } = setup();
		const proc = createFakeProcess({ [`sh ${hookPath}`]: {} });

		expect(await executeHook(hookPath, context, proc)).toEqual({
			status: "continue",
		});
		const [call] = proc.calls();
		expect(call?.options.cwd).toBe(context.repoRoot);
		expect(call?.options.stdin).toBe(JSON.stringify(context));
	});

	test("exit 2 blocks with the hook's stderr", async () => {
		const { mainaDir, hookPath, context } = setup();
		const proc = createFakeProcess({
			[`sh ${hookPath}`]: { exitCode: 2, stderr: "no secrets allowed\n" },
		});
		expect(await runHooks(mainaDir, "pre-commit", context, proc)).toEqual({
			status: "block",
			message: "no secrets allowed",
		});
	});

	test("a hook that cannot be started is a warning", async () => {
		const { hookPath, context } = setup();
		const result = await executeHook(hookPath, context, createFakeProcess());
		expect(result.status).toBe("warn");
	});
});
