import { describe, expect, test } from "bun:test";
import { createFixedClock, createMemoryFs } from "../../ports/testing";
import { brainPath, readBrain, writeBrain } from "../store";

const ROOT = "/repo";
const QUIRK = {
	kind: "quirk" as const,
	text: "tests need `bun run build` first",
};

describe("repo brain store (FR-FAC-5)", () => {
	test("an empty repo has an empty brain", async () => {
		expect(await readBrain(createMemoryFs(), ROOT)).toEqual({
			ok: true,
			value: [],
		});
	});

	test("unattended brain writes are denied and nothing is written", async () => {
		const fs = createMemoryFs();
		const written = await writeBrain(
			{ fs, clock: createFixedClock(0) },
			ROOT,
			QUIRK,
			{
				context: "unattended",
				runId: "run-1",
				approval: { by: "human", who: "maintainer" },
			},
		);
		expect(written).toEqual({
			ok: false,
			error: {
				kind: "denied",
				gate: { verdict: "deny", reason: "unattended" },
			},
		});
		expect(await fs.exists(brainPath(ROOT))).toBe(false);
	});

	test("an attended write without approval is not written", async () => {
		const fs = createMemoryFs();
		const written = await writeBrain(
			{ fs, clock: createFixedClock(0) },
			ROOT,
			QUIRK,
			{ context: "interactive", runId: "run-2" },
		);
		expect(written.ok ? undefined : written.error.kind).toBe("denied");
		expect(await fs.exists(brainPath(ROOT))).toBe(false);
	});

	test("an approved attended write is stored with who approved it", async () => {
		const fs = createMemoryFs();
		const ports = { fs, clock: createFixedClock(Date.UTC(2026, 8, 26)) };
		const written = await writeBrain(ports, ROOT, QUIRK, {
			context: "interactive",
			runId: "run-3",
			approval: { by: "human", who: "maintainer" },
		});
		expect(written.ok).toBe(true);
		if (!written.ok) return;
		expect(written.value).toMatchObject({
			kind: "quirk",
			text: QUIRK.text,
			runId: "run-3",
			approvedBy: "human",
			createdAt: "2026-09-26T00:00:00.000Z",
		});
		expect(await readBrain(fs, ROOT)).toEqual({
			ok: true,
			value: [written.value],
		});
	});

	test("the same memory written twice is stored once", async () => {
		const fs = createMemoryFs();
		const ports = { fs, clock: createFixedClock(0) };
		const gate = {
			context: "interactive" as const,
			runId: "run-4",
			approval: { by: "human" as const, who: "maintainer" },
		};
		const first = await writeBrain(ports, ROOT, QUIRK, gate);
		const second = await writeBrain(ports, ROOT, QUIRK, gate);
		expect(second).toEqual(first);
		const read = await readBrain(fs, ROOT);
		expect(read.ok && read.value.length).toBe(1);
	});

	test("a corrupt brain file is an error, not an empty brain", async () => {
		const fs = createMemoryFs({ [brainPath(ROOT)]: "{not json" });
		const read = await readBrain(fs, ROOT);
		expect(read.ok ? undefined : read.error.kind).toBe("corrupt");
	});

	test("blank text is refused", async () => {
		const written = await writeBrain(
			{ fs: createMemoryFs(), clock: createFixedClock(0) },
			ROOT,
			{ kind: "finding", text: "  " },
			{
				context: "interactive",
				runId: "run-5",
				approval: { by: "human", who: "maintainer" },
			},
		);
		expect(written.ok ? undefined : written.error.kind).toBe("invalid_entry");
	});
});
