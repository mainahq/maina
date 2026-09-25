import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../program";

describe("maina.config warning before every command (#393)", () => {
	let dir: string;
	let previousCwd: string;
	let stderr: string[];
	const originalWrite = process.stderr.write.bind(process.stderr);

	beforeEach(() => {
		dir = join(
			tmpdir(),
			`maina-393-hook-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(dir, { recursive: true });
		previousCwd = process.cwd();
		process.chdir(dir);
		stderr = [];
		process.stderr.write = ((chunk: string | Uint8Array) => {
			stderr.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
	});

	afterEach(() => {
		process.stderr.write = originalWrite;
		process.chdir(previousCwd);
		rmSync(dir, { recursive: true, force: true });
	});

	async function run(): Promise<boolean> {
		const program = createProgram();
		let ran = false;
		program.command("noop-393").action(() => {
			ran = true;
		});
		await program.parseAsync(["node", "maina", "noop-393"]);
		return ran;
	}

	test("warns on stderr about each dropped field and still runs the command", async () => {
		writeFileSync(
			join(dir, "maina.config.js"),
			`module.exports = { provider: "custom-provider", bogus: true };`,
		);
		expect(await run()).toBe(true);
		const text = stderr.join("");
		expect(text).toContain("maina.config.js");
		expect(text).toContain("bogus");
	});

	test("prints nothing when the config is valid", async () => {
		writeFileSync(
			join(dir, "maina.config.js"),
			`module.exports = { provider: "custom-provider" };`,
		);
		expect(await run()).toBe(true);
		expect(stderr.join("")).not.toContain("maina.config.js");
	});
});
