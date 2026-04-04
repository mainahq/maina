import { describe, expect, it } from "bun:test";
import { parseCheckstyleOutput } from "../../linters/checkstyle";

describe("parseCheckstyleOutput", () => {
	it("should parse checkstyle XML", () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<checkstyle>
<file name="src/Main.java">
<error line="10" column="5" severity="error" message="Missing Javadoc comment" source="com.puppycrawl.tools.checkstyle.checks.javadoc"/>
<error line="20" severity="warning" message="Line is longer than 120 characters" source="com.puppycrawl.tools.checkstyle.checks.sizes"/>
</file>
</checkstyle>`;
		const diagnostics = parseCheckstyleOutput(xml);
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics[0]?.file).toBe("src/Main.java");
		expect(diagnostics[0]?.severity).toBe("error");
		expect(diagnostics[1]?.severity).toBe("warning");
	});

	it("should handle empty XML", () => {
		expect(parseCheckstyleOutput("")).toHaveLength(0);
	});
});
