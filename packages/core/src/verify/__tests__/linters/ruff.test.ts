import { describe, expect, it } from "bun:test";
import { parseRuffOutput } from "../../linters/ruff";

describe("parseRuffOutput", () => {
	it("should parse ruff JSON output into SyntaxDiagnostic[]", () => {
		const json = JSON.stringify([
			{
				code: "E501",
				message: "Line too long (120 > 88)",
				filename: "src/app.py",
				location: { row: 10, column: 1 },
				end_location: { row: 10, column: 120 },
				fix: null,
				noqa_row: 10,
			},
			{
				code: "F401",
				message: "os imported but unused",
				filename: "src/utils.py",
				location: { row: 3, column: 1 },
				end_location: { row: 3, column: 10 },
				fix: { applicability: "safe" },
				noqa_row: 3,
			},
		]);

		const diagnostics = parseRuffOutput(json);
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics[0]?.file).toBe("src/app.py");
		expect(diagnostics[0]?.line).toBe(10);
		expect(diagnostics[0]?.severity).toBe("warning");
		expect(diagnostics[1]?.file).toBe("src/utils.py");
	});

	it("should map E-codes to warning and F-codes to error", () => {
		const json = JSON.stringify([
			{
				code: "E501",
				message: "style",
				filename: "a.py",
				location: { row: 1, column: 1 },
				end_location: { row: 1, column: 1 },
			},
			{
				code: "F811",
				message: "redefined",
				filename: "a.py",
				location: { row: 2, column: 1 },
				end_location: { row: 2, column: 1 },
			},
		]);
		const diagnostics = parseRuffOutput(json);
		expect(diagnostics[0]?.severity).toBe("warning");
		expect(diagnostics[1]?.severity).toBe("error");
	});

	it("should handle empty array", () => {
		expect(parseRuffOutput("[]")).toHaveLength(0);
	});

	it("should handle malformed JSON", () => {
		expect(parseRuffOutput("not json")).toHaveLength(0);
	});
});
