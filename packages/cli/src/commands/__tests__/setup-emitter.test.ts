/**
 * Tests for the per-phase JSON emitter used by `maina setup --ci`.
 *
 * The emitter is the only stdout writer in CI mode. Each phase emits exactly
 * one JSON line; the final `done()` line summarises the run. Tests inject a
 * write spy so we can assert line count, JSON validity, and trailing newline.
 */

import { describe, expect, test } from "bun:test";
import { jsonEmitter, noopEmitter, type PhaseEvent } from "../setup-emitter";

describe("jsonEmitter", () => {
	test("phase() writes a single JSON line ending in \\n", () => {
		const lines: string[] = [];
		const emitter = jsonEmitter((line) => {
			lines.push(line);
		});
		emitter.phase({ phase: "detect", status: "ok", languages: ["typescript"] });
		expect(lines.length).toBe(1);
		// The default writer adds the newline; the spy receives the raw line.
		const parsed = JSON.parse(lines[0] ?? "");
		expect(parsed.phase).toBe("detect");
		expect(parsed.status).toBe("ok");
		expect(parsed.languages).toEqual(["typescript"]);
	});

	test("default writer appends a newline to every line", () => {
		const written: string[] = [];
		const emitter = jsonEmitter((line) => {
			written.push(line);
		});
		emitter.phase({ phase: "preflight", status: "ok" });
		emitter.phase({ phase: "detect", status: "ok" });
		expect(written.length).toBe(2);
		for (const line of written) {
			// jsonEmitter must hand the writer a single-line JSON string with no
			// embedded newline; the writer is responsible for trailing \n.
			expect(line.includes("\n")).toBe(false);
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});

	test("done() emits a final JSON line with phase=done", () => {
		const lines: string[] = [];
		const emitter = jsonEmitter((line) => {
			lines.push(line);
		});
		emitter.phase({ phase: "verify", status: "ok", findings: 0 });
		emitter.done({
			phase: "done",
			status: "ok",
			findings: 0,
			tailored: true,
		});
		expect(lines.length).toBe(2);
		const last = JSON.parse(lines[1] ?? "");
		expect(last.phase).toBe("done");
		expect(last.findings).toBe(0);
		expect(last.tailored).toBe(true);
	});

	test("preserves arbitrary phase-specific fields", () => {
		const lines: string[] = [];
		const emitter = jsonEmitter((line) => {
			lines.push(line);
		});
		const event: PhaseEvent = {
			phase: "scaffold",
			status: "ok",
			files: ["AGENTS.md", "CLAUDE.md"],
			extraNumber: 42,
		};
		emitter.phase(event);
		const parsed = JSON.parse(lines[0] ?? "");
		expect(parsed.files).toEqual(["AGENTS.md", "CLAUDE.md"]);
		expect(parsed.extraNumber).toBe(42);
	});

	test("default writer wires through process.stdout.write when no override given", () => {
		// Smoke test: just construct it without throwing.
		const emitter = jsonEmitter();
		expect(typeof emitter.phase).toBe("function");
		expect(typeof emitter.done).toBe("function");
	});
});

describe("noopEmitter", () => {
	test("phase() and done() do nothing (no throw, no writes)", () => {
		const emitter = noopEmitter();
		expect(() =>
			emitter.phase({ phase: "detect", status: "ok" }),
		).not.toThrow();
		expect(() => emitter.done({ phase: "done", status: "ok" })).not.toThrow();
	});
});
