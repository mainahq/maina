import { describe, expect, it } from "bun:test";
import { parseGoVetOutput } from "../../linters/go-vet";

describe("parseGoVetOutput", () => {
	it("should parse go vet text output", () => {
		const output = `# example.com/pkg
./main.go:15:2: unreachable code
./utils.go:8:4: loop variable captured by func literal`;

		const diagnostics = parseGoVetOutput(output);
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics[0]?.file).toBe("./main.go");
		expect(diagnostics[0]?.line).toBe(15);
		expect(diagnostics[0]?.severity).toBe("error");
		expect(diagnostics[0]?.message).toContain("unreachable code");
	});

	it("should handle empty output", () => {
		expect(parseGoVetOutput("")).toHaveLength(0);
	});

	it("should skip package header lines", () => {
		const output = `# example.com/pkg
vet: checking...`;
		expect(parseGoVetOutput(output)).toHaveLength(0);
	});
});
