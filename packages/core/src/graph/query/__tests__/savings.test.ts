import { describe, expect, test } from "bun:test";
import { calculateTokens } from "../../../context/budget";
import { naiveReadTokens, tokenSavings } from "../savings";

describe("savings", () => {
	test("the naive read costs every file in full, each counted once", () => {
		const files = new Map([
			["a.ts", "export const a = 1;\n"],
			["b.ts", "export function b() {\n\treturn 2;\n}\n"],
		]);
		expect(naiveReadTokens(files)).toBe(
			calculateTokens("export const a = 1;\n") +
				calculateTokens("export function b() {\n\treturn 2;\n}\n"),
		);
		expect(naiveReadTokens(new Map())).toBe(0);
	});

	test("saved tokens never go negative", () => {
		expect(tokenSavings(100, 30)).toBe(70);
		expect(tokenSavings(10, 30)).toBe(0);
	});
});
