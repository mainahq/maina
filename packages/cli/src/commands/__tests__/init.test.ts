/**
 * `maina init` is a deprecated alias of `maina setup` (#288).
 *
 * It accepts every `setup` flag, prints a deprecation notice on stderr and
 * delegates to the same command runner, so there is one onboarding flow.
 */

import { describe, expect, test } from "bun:test";
import { INIT_DEPRECATION_NOTICE, initCommand } from "../init";
import { type SetupCommandOptions, setupCommand } from "../setup";

function longFlags(cmd: ReturnType<typeof setupCommand>): string[] {
	return cmd.options.map((o) => o.long ?? "").filter((f) => f.length > 0);
}

function fakeDeps() {
	const calls: { warn: string[]; run: SetupCommandOptions[] } = {
		warn: [],
		run: [],
	};
	return {
		calls,
		deps: {
			warn: (message: string) => {
				calls.warn.push(message);
			},
			run: async (opts: SetupCommandOptions) => {
				calls.run.push(opts);
			},
		},
	};
}

describe("maina init (deprecated alias of setup)", () => {
	test("describes itself as a deprecated alias", () => {
		expect(initCommand().description().toLowerCase()).toContain("deprecated");
		expect(initCommand().description()).toContain("setup");
	});

	test("accepts every setup flag", () => {
		const initFlags = longFlags(initCommand());
		for (const flag of longFlags(setupCommand())) {
			expect(initFlags).toContain(flag);
		}
	});

	test("prints the deprecation notice, then runs setup with the parsed flags", async () => {
		const { calls, deps } = fakeDeps();
		await initCommand(deps).parseAsync(["--yes", "--legacy-agents"], {
			from: "user",
		});
		expect(calls.warn[0]).toBe(INIT_DEPRECATION_NOTICE);
		expect(calls.run.length).toBe(1);
		expect(calls.run[0]?.yes).toBe(true);
		expect(calls.run[0]?.legacyAgents).toBe(true);
	});

	test("old --force / --install flags are accepted but explained, not honoured", async () => {
		const { calls, deps } = fakeDeps();
		await initCommand(deps).parseAsync(["--force", "--install"], {
			from: "user",
		});
		expect(calls.run.length).toBe(1);
		const notes = calls.warn.join("\n");
		expect(notes).toContain("--force");
		expect(notes).toContain("--install");
	});
});
