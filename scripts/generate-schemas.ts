#!/usr/bin/env bun
/**
 * Generates `schemas/*.schema.json` from the zod schemas in
 * `@mainahq/core` (the single source of truth, ADR 0043).
 *
 *   bun scripts/generate-schemas.ts          write the files
 *   bun scripts/generate-schemas.ts --check  exit 1 if a committed file differs
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
	configJsonSchema,
	renderJsonSchema,
} from "../packages/core/src/config/schema";
import { policyJsonSchema } from "../packages/core/src/policy/schema";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "schemas");

const SCHEMAS: ReadonlyArray<readonly [string, () => unknown]> = [
	["maina.config.schema.json", configJsonSchema],
	["policy.schema.json", policyJsonSchema],
];

function readOrEmpty(path: string): string {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return "";
	}
}

const check = process.argv.includes("--check");
const stale: string[] = [];

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, build] of SCHEMAS) {
	const path = join(OUT_DIR, name);
	const rendered = renderJsonSchema(build());
	if (readOrEmpty(path) === rendered) continue;
	if (check) {
		stale.push(relative(ROOT, path));
	} else {
		writeFileSync(path, rendered);
		console.log(`wrote ${relative(ROOT, path)}`);
	}
}

if (stale.length > 0) {
	console.error(
		`Out of date: ${stale.join(", ")}. Run \`bun run schemas:generate\` and commit the result.`,
	);
	process.exit(1);
}
