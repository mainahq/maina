/**
 * Default prompts must survive compilation (#294).
 *
 * `@mainahq/core` used to ship its `src/` tree, so `loadDefault` could read
 * `defaults/<task>.md` next to itself at runtime. The published package is
 * now a compiled bundle in `dist/` with no `.md` files beside it, so the
 * templates are inlined at build time. Without that, every AI command would
 * silently fall back to the generic template.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PromptTask } from "../defaults/index";

const DEFAULTS_DIR = join(import.meta.dir, "..", "defaults");
const outdir = mkdtempSync(join(tmpdir(), "maina-defaults-bundle-"));

afterAll(() => {
	rmSync(outdir, { recursive: true, force: true });
});

const TASKS: readonly PromptTask[] = [
	"review",
	"commit",
	"tests",
	"fix",
	"explain",
	"design",
	"context",
	"spec-questions",
	"design-approaches",
	"ai-review",
	"design-hld-lld",
	"wiki-query",
	"wiki-compile",
	"walkthrough",
];

describe("default prompts after bundling", () => {
	test("load from a node-target bundle with no template files beside it", async () => {
		const result = await Bun.build({
			entrypoints: [join(DEFAULTS_DIR, "index.ts")],
			outdir,
			target: "node",
			format: "esm",
		});
		expect(result.success).toBe(true);
		const bundled = (await import(join(outdir, "index.js"))) as {
			loadDefault: (task: PromptTask) => Promise<string>;
		};
		for (const task of TASKS) {
			const expected = readFileSync(join(DEFAULTS_DIR, `${task}.md`), "utf-8");
			expect({ task, text: await bundled.loadDefault(task) }).toEqual({
				task,
				text: expected,
			});
		}
	});
});
