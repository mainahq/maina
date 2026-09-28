import { describe, expect, test } from "bun:test";
import { systemInventoryProbe, systemProbe } from "../probe";

describe("systemInventoryProbe (#591)", () => {
	test("version reads --version output without blocking", async () => {
		const pending = systemInventoryProbe.version(process.execPath);
		expect(pending).toBeInstanceOf(Promise);
		expect(await pending).toContain(Bun.version);
	});

	test("version answers null when the binary cannot run", async () => {
		expect(
			await systemInventoryProbe.version("/nonexistent/maina-agent-591"),
		).toBeNull();
	});
});

describe("systemProbe", () => {
	test("which finds a binary on PATH", () => {
		expect(systemProbe.which("bun")).toMatch(/bun/);
	});

	test("which answers null for a missing binary", () => {
		expect(systemProbe.which("maina-no-such-agent-315")).toBeNull();
	});

	test("version reads --version output", () => {
		expect(systemProbe.version(process.execPath)).toContain(Bun.version);
	});

	test("version answers null when the binary cannot run", () => {
		expect(systemProbe.version("/nonexistent/maina-agent-315")).toBeNull();
	});
});
