import { describe, expect, it } from "bun:test";
import { parseClippyOutput } from "../../linters/clippy";

describe("parseClippyOutput", () => {
	it("should parse clippy JSON messages", () => {
		const lines = [
			JSON.stringify({
				reason: "compiler-message",
				message: {
					code: { code: "clippy::unwrap_used" },
					level: "warning",
					message: "used `unwrap()` on a `Result` value",
					spans: [
						{ file_name: "src/main.rs", line_start: 10, column_start: 5 },
					],
				},
			}),
			JSON.stringify({ reason: "build-finished", success: true }),
		].join("\n");

		const diagnostics = parseClippyOutput(lines);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.file).toBe("src/main.rs");
		expect(diagnostics[0]?.line).toBe(10);
		expect(diagnostics[0]?.severity).toBe("warning");
	});

	it("should handle empty output", () => {
		expect(parseClippyOutput("")).toHaveLength(0);
	});

	it("should map error level correctly", () => {
		const line = JSON.stringify({
			reason: "compiler-message",
			message: {
				code: { code: "E0308" },
				level: "error",
				message: "mismatched types",
				spans: [{ file_name: "src/lib.rs", line_start: 5, column_start: 1 }],
			},
		});
		const diagnostics = parseClippyOutput(line);
		expect(diagnostics[0]?.severity).toBe("error");
	});
});
