/**
 * The landing page's Lighthouse budget (#360): the config CI runs, and the
 * CI job that runs it on every pull request.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const read = (rel: string): string =>
	readFileSync(join(REPO_ROOT, rel), "utf-8");

type Assertion = readonly [
	string,
	Readonly<{ minScore?: number; maxNumericValue?: number }>,
];
type LhConfig = Readonly<{
	ci: Readonly<{
		collect: Readonly<{ staticDistDir: string; url: readonly string[] }>;
		assert: Readonly<{ assertions: Readonly<Record<string, Assertion>> }>;
	}>;
}>;

const config = JSON.parse(read("packages/docs/lighthouserc.json")) as LhConfig;

describe("landing Lighthouse budget", () => {
	test("audits the built landing page", () => {
		expect(config.ci.collect.staticDistDir).toBe("./dist");
		expect(config.ci.collect.url).toEqual(["http://localhost/index.html"]);
	});

	test("fails under the category floors", () => {
		const a = config.ci.assert.assertions;
		const floor = (key: string): number => a[key]?.[1].minScore ?? 0;
		expect(a["categories:performance"]?.[0]).toBe("error");
		expect(floor("categories:performance")).toBeGreaterThanOrEqual(0.9);
		expect(floor("categories:accessibility")).toBeGreaterThanOrEqual(0.95);
		expect(floor("categories:best-practices")).toBeGreaterThanOrEqual(0.9);
		expect(floor("categories:seo")).toBeGreaterThanOrEqual(0.9);
	});

	test("holds a byte and timing budget for /", () => {
		// lhci cannot combine a budgets file with assertions, so the budget
		// is written as resource-summary and metric assertions.
		const a = config.ci.assert.assertions;
		const max = (key: string): number =>
			a[key]?.[1].maxNumericValue ?? Number.POSITIVE_INFINITY;
		expect(max("resource-summary:script:size")).toBeLessThanOrEqual(60 * 1024);
		expect(max("resource-summary:total:size")).toBeLessThanOrEqual(600 * 1024);
		expect(max("largest-contentful-paint")).toBeLessThanOrEqual(2500);
		expect(max("cumulative-layout-shift")).toBeLessThanOrEqual(0.1);
		for (const [key, [level]] of Object.entries(a)) {
			expect(`${key}:${level}`).toBe(`${key}:error`);
		}
	});

	test("runs in CI on pull requests", () => {
		const ci = read(".github/workflows/ci.yml");
		expect(ci).toContain("landing-lighthouse:");
		expect(ci).toContain("@lhci/cli");
		expect(ci).toContain("--config=./lighthouserc.json");
	});
});
