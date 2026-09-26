import { describe, expect, test } from "bun:test";
import { generateAgentsMd } from "../agents-md";
import type { StackContext } from "../types";

function ctxWith(packageManager: string): StackContext {
	return {
		languages: ["typescript"],
		frameworks: [],
		packageManager,
		buildTool: null,
		linters: ["biome"],
		testRunners: ["vitest"],
		cicd: [],
		repoSize: { files: 10, bytes: 1024 },
		isEmpty: false,
		isLarge: false,
	};
}

const quickRef = "- TDD always";

describe("generateAgentsMd package-manager commands", () => {
	test("pnpm repos get pnpm install / pnpm run commands", () => {
		const md = generateAgentsMd(ctxWith("pnpm"), quickRef);
		expect(md).toContain("pnpm install");
		expect(md).toContain("`pnpm run test`");
		expect(md).toContain("`pnpm run check`");
		expect(md).not.toMatch(/^npm install$/m);
		expect(md).not.toContain("`npm run");
	});

	test("yarn repos get yarn install / yarn run commands", () => {
		const md = generateAgentsMd(ctxWith("yarn"), quickRef);
		expect(md).toContain("yarn install");
		expect(md).toContain("`yarn run test`");
		// `yarn check` is a yarn v1 builtin, so scripts must go through `yarn run`.
		expect(md).toContain("`yarn run check`");
		expect(md).not.toMatch(/^npm install$/m);
		expect(md).not.toContain("`npm run");
	});

	test("bun repos keep bun commands", () => {
		const md = generateAgentsMd(ctxWith("bun"), quickRef);
		expect(md).toContain("bun install");
		expect(md).toContain("`bun test`");
		expect(md).not.toContain("npm");
	});

	test("npm repos get npm commands", () => {
		const md = generateAgentsMd(ctxWith("npm"), quickRef);
		expect(md).toContain("npm install");
		expect(md).toContain("`npm run test`");
	});

	test("empty or non-JS package manager falls back to npm", () => {
		expect(generateAgentsMd(ctxWith(""), quickRef)).toContain("npm install");
		for (const pm of ["unknown", "pip", "constructor"]) {
			expect(generateAgentsMd(ctxWith(pm), quickRef)).toContain(
				"`npm run test`",
			);
		}
	});
});
