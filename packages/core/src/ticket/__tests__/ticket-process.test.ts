/** Issue #433: `gh issue create` runs through a `ProcessPort`. */

import { describe, expect, test } from "bun:test";
import { createFakeProcess } from "../../ports/testing";
import { createTicket, processSpawnDeps } from "../index";

describe("createTicket over an injected ProcessPort", () => {
	test("creates the issue with gh in the given cwd", async () => {
		const proc = createFakeProcess({
			"gh issue create --title T --body B": {
				stdout: "https://github.com/o/r/issues/42\n",
			},
		});
		const result = await createTicket(
			{ title: "T", body: "B", cwd: "/repo" },
			processSpawnDeps(proc),
		);
		expect(result).toEqual({
			ok: true,
			value: { url: "https://github.com/o/r/issues/42", number: 42 },
		});
		expect(proc.calls()[0]?.options.cwd).toBe("/repo");
	});

	test("a gh that cannot start is an error result", async () => {
		const result = await createTicket(
			{ title: "T", body: "B", cwd: "/repo" },
			processSpawnDeps(createFakeProcess()),
		);
		expect(result.ok).toBe(false);
	});
});
