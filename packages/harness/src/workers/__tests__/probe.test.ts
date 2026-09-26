import { describe, expect, test } from "bun:test";
import { systemProbe } from "../probe";

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
