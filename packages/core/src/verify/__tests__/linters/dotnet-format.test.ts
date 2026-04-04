import { describe, expect, it } from "bun:test";
import { parseDotnetFormatOutput } from "../../linters/dotnet-format";

describe("parseDotnetFormatOutput", () => {
	it("should parse dotnet format diagnostics", () => {
		const output = `Program.cs(10,5): warning CS1234: Unused variable 'x'
Service.cs(20,1): error CS0246: The type or namespace name 'Foo' could not be found`;
		const diagnostics = parseDotnetFormatOutput(output);
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics[0]?.file).toBe("Program.cs");
		expect(diagnostics[0]?.severity).toBe("warning");
		expect(diagnostics[1]?.severity).toBe("error");
	});

	it("should handle empty output", () => {
		expect(parseDotnetFormatOutput("")).toHaveLength(0);
	});
});
