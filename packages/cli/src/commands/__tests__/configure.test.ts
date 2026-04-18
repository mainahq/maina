import { describe, expect, it } from "bun:test";
import { type ConfigureActionOptions, configureAction } from "../configure";
import type { SetupActionOptions } from "../setup";

/**
 * Tests for `maina configure` — deprecated alias for `maina setup --update`.
 *
 * Sub-task 9 of issue #174.
 */

type Captured = {
	stderr: string[];
	setupCalls: SetupActionOptions[];
};

function harness(): {
	captured: Captured;
	stderr: (msg: string) => void;
	setupFn: (opts: SetupActionOptions) => Promise<void>;
} {
	const captured: Captured = { stderr: [], setupCalls: [] };
	const stderr = (msg: string) => {
		captured.stderr.push(msg);
	};
	const setupFn = async (opts: SetupActionOptions) => {
		captured.setupCalls.push(opts);
	};
	return { captured, stderr, setupFn };
}

describe("configureAction (deprecated)", () => {
	it("emits a deprecation notice to stderr", async () => {
		const { captured, stderr, setupFn } = harness();

		await configureAction({}, { stderr, setupFn });

		const joined = captured.stderr.join("");
		expect(joined).toContain("deprecated");
		expect(joined).toContain("v1.3");
		expect(joined).toContain("v1.5");
		expect(joined).toContain("maina setup --update");
	});

	it("invokes setupAction with mode: 'update'", async () => {
		const { captured, stderr, setupFn } = harness();

		await configureAction({}, { stderr, setupFn });

		expect(captured.setupCalls.length).toBe(1);
		expect(captured.setupCalls[0]?.mode).toBe("update");
	});

	it("maps --no-interactive to ci:true and yes:true", async () => {
		const { captured, stderr, setupFn } = harness();

		await configureAction({ noInteractive: true }, { stderr, setupFn });

		const call = captured.setupCalls[0];
		expect(call?.ci).toBe(true);
		expect(call?.yes).toBe(true);
	});

	it("leaves ci/yes false when interactive (default)", async () => {
		const { captured, stderr, setupFn } = harness();

		await configureAction({}, { stderr, setupFn });

		const call = captured.setupCalls[0];
		expect(call?.ci).toBe(false);
		expect(call?.yes).toBe(false);
	});

	it("forwards cwd to setupAction", async () => {
		const { captured, stderr, setupFn } = harness();
		const cwd = "/tmp/fixture";

		await configureAction({ cwd } satisfies ConfigureActionOptions, {
			stderr,
			setupFn,
		});

		expect(captured.setupCalls[0]?.cwd).toBe(cwd);
	});

	it("mentions the non-interactive replacement incantation", async () => {
		const { captured, stderr, setupFn } = harness();

		await configureAction({ noInteractive: true }, { stderr, setupFn });

		const joined = captured.stderr.join("");
		// Muscle-memory hint: users running `configure --no-interactive` should
		// see the new `setup --update --ci` incantation.
		expect(joined).toContain("--ci");
	});
});
