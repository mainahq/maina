/**
 * What the plugin cells measure for the release evidence (spec §9.1): the
 * time to a first result and the traces an uninstall leaves, appended to
 * `MAINA_E2E_MEASUREMENTS` whether the case passes or fails.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureFirstResult, measureUninstall } from "../measurements";

const dir = mkdtempSync(join(tmpdir(), "maina-measure-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const read = (file: string) =>
	readFileSync(file, "utf-8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l));

describe("measureFirstResult", () => {
	test("records the elapsed seconds and success", async () => {
		const file = join(dir, "ok.jsonl");
		await measureFirstResult("claude", async () => {}, file);
		const [rec] = read(file);
		expect(rec.kind).toBe("first-result");
		expect(rec.host).toBe("claude");
		expect(rec.ok).toBe(true);
		expect(rec.seconds).toBeGreaterThanOrEqual(0);
		expect(["darwin", "linux"]).toContain(rec.os);
	});

	test("a failing case is recorded as failed and still fails", async () => {
		const file = join(dir, "fail.jsonl");
		await expect(
			measureFirstResult(
				"cursor",
				async () => {
					throw new Error("verify never answered");
				},
				file,
			),
		).rejects.toThrow("verify never answered");
		expect(read(file)[0].ok).toBe(false);
	});

	test("without a file nothing is written", async () => {
		await measureFirstResult("codex", async () => {}, undefined);
	});
});

describe("measureUninstall", () => {
	test("records the traces the case reported", async () => {
		const file = join(dir, "u.jsonl");
		await measureUninstall(
			"codex",
			async (report) => {
				report(["added home/.codex/x"]);
			},
			file,
		);
		expect(read(file)[0]).toMatchObject({
			kind: "uninstall",
			host: "codex",
			traces: ["added home/.codex/x"],
		});
	});

	test("a case that fails before its trace check records why", async () => {
		const file = join(dir, "u2.jsonl");
		await expect(
			measureUninstall(
				"claude",
				async () => {
					throw new Error("plugin not enabled");
				},
				file,
			),
		).rejects.toThrow();
		expect(read(file)[0].traces).toEqual([
			"the uninstall case failed before its trace check: plugin not enabled",
		]);
	});
});
