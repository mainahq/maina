/**
 * The setup templates must survive bundling (issue #287).
 *
 * `@mainahq/core` ships its `src/` tree, so file-relative template reads
 * worked there. The CLI is bundled by bunup into `dist/`, where the `.md`
 * files do not exist next to the chunk, so the loaders must inline their
 * templates at build time instead of reading them from disk at runtime.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SETUP_DIR = join(import.meta.dir, "..");
const outdir = mkdtempSync(join(tmpdir(), "maina-setup-bundle-"));

afterAll(() => {
	rmSync(outdir, { recursive: true, force: true });
});

async function bundle(): Promise<{
	tailor: typeof import("../tailor");
	prompts: typeof import("../prompts");
}> {
	const result = await Bun.build({
		entrypoints: [join(SETUP_DIR, "tailor.ts"), join(SETUP_DIR, "prompts.ts")],
		outdir,
		target: "bun",
		format: "esm",
		external: ["@mainahq/core"],
	});
	expect(result.success).toBe(true);
	return {
		tailor: await import(join(outdir, "tailor.js")),
		prompts: await import(join(outdir, "prompts.js")),
	};
}

describe("setup templates after bundling", () => {
	test("render from a bundle with no template files beside it", async () => {
		const { tailor, prompts } = await bundle();

		expect(tailor.renderWorkflowSection()).toContain("## Maina Workflow");
		expect(
			tailor.renderFileLayoutSection({
				languages: ["typescript"],
				toplevelDirs: ["src"],
			}),
		).toContain("## File Layout");
		const prompt = prompts.loadUniversalPrompt({
			stack: "STACK_MARKER",
			repoSummary: "SUMMARY_MARKER",
		});
		expect(prompt).toContain("STACK_MARKER");
		expect(prompt).toContain("SUMMARY_MARKER");
	});
});
