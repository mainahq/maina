/**
 * Golden tests for every heuristic decision site (v1 plan task 0.2, FR-DEC-6).
 *
 * Replays each recorded `{ site, input, output }` fixture under
 * `__golden__/decisions/` and asserts current behaviour is byte-for-byte the
 * recorded output. Fixtures are (re)captured with `bun scripts/golden-capture.ts`;
 * a diff in a fixture is a behaviour change and must be reviewed as one.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	fixtureFileName,
	GOLDEN_SITES,
	type GoldenFixtureFile,
	isGoldenSite,
	MIN_CASES_PER_SITE,
	runSite,
} from "./sites";

const FIXTURE_DIR = join(import.meta.dir, "decisions");

function loadFixtures(): GoldenFixtureFile[] {
	if (!existsSync(FIXTURE_DIR)) return [];
	return readdirSync(FIXTURE_DIR)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map(
			(f) =>
				JSON.parse(
					readFileSync(join(FIXTURE_DIR, f), "utf-8"),
				) as GoldenFixtureFile,
		);
}

const fixtures = loadFixtures();

describe("golden decision fixtures", () => {
	test.each([
		...GOLDEN_SITES,
	])(`%s has at least ${MIN_CASES_PER_SITE} recorded inputs`, (site) => {
		const file = fixtures.find((f) => f.site === site);
		expect(file?.cases.length ?? 0).toBeGreaterThanOrEqual(MIN_CASES_PER_SITE);
	});

	test("every fixture file names a known site and matches its file name", () => {
		const names = existsSync(FIXTURE_DIR) ? readdirSync(FIXTURE_DIR) : [];
		for (const f of names.filter((n) => n.endsWith(".json"))) {
			const parsed = JSON.parse(
				readFileSync(join(FIXTURE_DIR, f), "utf-8"),
			) as { site: unknown; cases: Array<{ site: unknown }> };
			expect(isGoldenSite(parsed.site)).toBe(true);
			if (!isGoldenSite(parsed.site)) continue;
			expect(f).toBe(`${fixtureFileName(parsed.site)}.json`);
			for (const c of parsed.cases) expect(c.site).toBe(parsed.site);
		}
	});
});

for (const file of fixtures) {
	describe(`golden: ${file.site}`, () => {
		file.cases.forEach((c, i) => {
			test(`case ${i + 1}`, async () => {
				const actual = await runSite(file.site, c.input);
				expect(actual).toStrictEqual(c.output);
			});
		});
	});
}
