import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigError } from "@mainahq/core";
import { formatConfigWarnings, warnOnConfigErrors } from "../config-warnings";

const FILE = "/repo/maina.config.ts";

describe("formatConfigWarnings (#393)", () => {
	test("renders nothing when there are no errors", () => {
		expect(formatConfigWarnings([])).toBe("");
	});

	test("names the file, says the rest still applies, and lists every dropped path", () => {
		const errors: ConfigError[] = [
			{
				kind: "invalid",
				file: FILE,
				path: "bogus",
				message: 'Unrecognized key: "bogus"',
			},
			{
				kind: "invalid",
				file: FILE,
				path: "models.standard",
				message: "Too small",
			},
		];
		const text = formatConfigWarnings(errors);
		expect(text).toContain(FILE);
		expect(text).toContain("2 invalid entries");
		expect(text).toContain("rest of the config still applies");
		expect(text).toContain('bogus: Unrecognized key: "bogus"');
		expect(text).toContain("models.standard: Too small");
		expect(text.endsWith("\n")).toBe(true);
	});

	test("labels a root-level error and an unloadable module", () => {
		const text = formatConfigWarnings([
			{ kind: "parse", file: FILE, path: "", message: "Unexpected token" },
		]);
		expect(text).toContain("could not load");
		expect(text).toContain("defaults");
		expect(text).toContain("Unexpected token");
	});
});

describe("warnOnConfigErrors (#393)", () => {
	let dir: string;

	beforeEach(() => {
		dir = join(
			tmpdir(),
			`maina-393-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(dir, { recursive: true });
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("writes a warning for a config module with an unknown key", async () => {
		writeFileSync(
			join(dir, "maina.config.js"),
			`module.exports = { provider: "custom-provider", bogus: true };`,
		);
		const written: string[] = [];
		const errors = await warnOnConfigErrors(dir, (text) => written.push(text));
		expect(errors.map((e) => e.path)).toEqual(["bogus"]);
		expect(written.join("")).toContain("bogus");
	});

	test("stays silent when the config is valid or absent", async () => {
		const written: string[] = [];
		await warnOnConfigErrors(dir, (text) => written.push(text));
		writeFileSync(
			join(dir, "maina.config.js"),
			`module.exports = { provider: "custom-provider" };`,
		);
		await warnOnConfigErrors(dir, (text) => written.push(text));
		expect(written).toEqual([]);
	});
});
