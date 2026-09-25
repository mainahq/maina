/**
 * Tests for skills deployment — copies `@mainahq/skills/<name>/SKILL.md`
 * trees into `<cwd>/.maina/skills/<name>/SKILL.md`.
 */

import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploySkills, skillsRootCandidates } from "../skills-deploy";

const EXPECTED_SKILLS = [
	"cloud-workflow",
	"code-review",
	"context-generation",
	"onboarding",
	"plan-writing",
	"tdd",
	"verification-workflow",
	"wiki-workflow",
];

function tmpRepo(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `maina-${prefix}-`));
}

/** Build a fake skills source tree so tests don't rely on the monorepo layout. */
function makeFakeSkillsRoot(names: string[]): string {
	const root = mkdtempSync(join(tmpdir(), "maina-skills-src-"));
	for (const name of names) {
		const dir = join(root, name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "SKILL.md"),
			`# ${name}\n\nContent for ${name}.\n`,
			"utf-8",
		);
	}
	// Drop noise so the scanner must filter.
	writeFileSync(join(root, "README.md"), "readme", "utf-8");
	mkdirSync(join(root, "node_modules"), { recursive: true });
	return root;
}

describe("deploySkills", () => {
	test("materialises every SKILL.md under .maina/skills/<name>/", async () => {
		const cwd = tmpRepo("skills-deploy");
		const src = makeFakeSkillsRoot(EXPECTED_SKILLS);
		try {
			const res = await deploySkills({ cwd, sourceRoot: src });
			expect(res.ok).toBe(true);
			if (!res.ok) return;
			expect(res.value.deployed.length).toBe(EXPECTED_SKILLS.length);

			for (const name of EXPECTED_SKILLS) {
				const target = join(cwd, ".maina/skills", name, "SKILL.md");
				expect(existsSync(target)).toBe(true);
				const content = readFileSync(target, "utf-8");
				expect(content).toContain(`# ${name}`);
			}
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(src, { recursive: true, force: true });
		}
	});

	test("idempotent: second run writes identical bytes (no duplicates)", async () => {
		const cwd = tmpRepo("skills-idempotent");
		const src = makeFakeSkillsRoot(["tdd", "code-review"]);
		try {
			await deploySkills({ cwd, sourceRoot: src });
			const firstTdd = readFileSync(
				join(cwd, ".maina/skills/tdd/SKILL.md"),
				"utf-8",
			);
			const firstListing = readdirSync(join(cwd, ".maina/skills")).sort();

			await deploySkills({ cwd, sourceRoot: src });
			const secondTdd = readFileSync(
				join(cwd, ".maina/skills/tdd/SKILL.md"),
				"utf-8",
			);
			const secondListing = readdirSync(join(cwd, ".maina/skills")).sort();
			expect(secondTdd).toBe(firstTdd);
			expect(secondListing).toEqual(firstListing);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(src, { recursive: true, force: true });
		}
	});

	test("skips dirs without SKILL.md", async () => {
		const cwd = tmpRepo("skills-skip");
		const src = mkdtempSync(join(tmpdir(), "maina-skills-empty-"));
		try {
			mkdirSync(join(src, "missing-skill"), { recursive: true });
			writeFileSync(
				join(src, "missing-skill", "README.md"),
				"no skill here",
				"utf-8",
			);
			// Add one real skill too.
			mkdirSync(join(src, "real"), { recursive: true });
			writeFileSync(join(src, "real", "SKILL.md"), "# real\n", "utf-8");
			const res = await deploySkills({ cwd, sourceRoot: src });
			expect(res.ok).toBe(true);
			if (!res.ok) return;
			expect(res.value.deployed).toEqual(["real"]);
			expect(existsSync(join(cwd, ".maina/skills/missing-skill"))).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(src, { recursive: true, force: true });
		}
	});

	test("returns warning (not error) when source root does not exist", async () => {
		const cwd = tmpRepo("skills-nosrc");
		try {
			const res = await deploySkills({
				cwd,
				sourceRoot: join(tmpdir(), `maina-doesnt-exist-${Date.now()}`),
			});
			expect(res.ok).toBe(true);
			if (!res.ok) return;
			expect(res.value.deployed.length).toBe(0);
			expect(res.value.warnings.length).toBeGreaterThan(0);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	test("auto-resolves the monorepo skills package when sourceRoot is omitted", async () => {
		// This test relies on the real `packages/skills/*/SKILL.md` layout in
		// the monorepo — if it ever fails outside the monorepo, the runner is
		// installed from npm and the test should still pass because the
		// resolver finds `@mainahq/skills/<name>/SKILL.md` in node_modules.
		const cwd = tmpRepo("skills-auto");
		try {
			const res = await deploySkills({ cwd });
			expect(res.ok).toBe(true);
			if (!res.ok) return;
			// Should find at least one skill. We don't lock the exact count so
			// this test stays stable when new skills ship.
			expect(res.value.deployed.length).toBeGreaterThan(0);
			for (const name of res.value.deployed) {
				expect(existsSync(join(cwd, ".maina/skills", name, "SKILL.md"))).toBe(
					true,
				);
			}
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("skillsRootCandidates", () => {
	// The CLI runs from source in tests and from a bunup bundle once built or
	// installed, where this module lands in a code-split chunk under
	// `dist/shared/`. `import.meta.url` therefore sits at different depths;
	// every layout must reach the `skills` package next to the `cli` package.
	const pkgRoots = new Set([
		"/repo/packages/cli",
		"/g/node_modules/@mainahq/cli",
	]);
	const hasPackageJson = (dir: string) => pkgRoots.has(dir);

	test.each([
		["source", "/repo/packages/cli/src/onboarding/setup"],
		["bundle entry", "/repo/packages/cli/dist"],
		["bundle chunk", "/repo/packages/cli/dist/shared"],
	])("from the %s reaches packages/skills", (_layout, here) => {
		// In the monorepo the nested path is the workspace link to
		// packages/skills, so both candidates name the same package.
		expect(skillsRootCandidates(here, hasPackageJson)).toEqual([
			"/repo/packages/cli/node_modules/@mainahq/skills",
			"/repo/packages/skills",
		]);
	});

	test("from an installed chunk reaches the nested dependency, then the hoisted sibling (#384)", () => {
		// npm's global install nests the CLI's own (pinned) dependency in its
		// node_modules; a hoisted layout (bun/pnpm) keeps it next to the CLI.
		// The nested copy comes first: under npm the sibling is a separate
		// global `@mainahq/skills` install (what the old warning told users
		// to add), which may be stale and must not shadow the CLI's version.
		expect(
			skillsRootCandidates(
				"/g/node_modules/@mainahq/cli/dist/shared",
				hasPackageJson,
			),
		).toEqual([
			"/g/node_modules/@mainahq/cli/node_modules/@mainahq/skills",
			"/g/node_modules/@mainahq/skills",
		]);
	});

	test("with no enclosing package there is no candidate", () => {
		expect(skillsRootCandidates("/tmp/a/b", hasPackageJson)).toEqual([]);
	});
});

describe("@mainahq/cli ships its skills (#384)", () => {
	// `maina setup` always deploys skills; a global install of the CLI alone
	// must be able to resolve them, so the CLI depends on the skills package
	// at the shared (fixed-group) version.
	const pkgDir = (name: string) =>
		join(import.meta.dir, "..", "..", "..", "..", "..", name);
	const manifest = (name: string) =>
		JSON.parse(readFileSync(join(pkgDir(name), "package.json"), "utf-8")) as {
			version: string;
			dependencies?: Record<string, string>;
		};

	test("@mainahq/skills is a runtime dependency of @mainahq/cli", () => {
		const cli = manifest("cli");
		const skills = manifest("skills");
		expect(cli.dependencies?.["@mainahq/skills"]).toBe(skills.version);
	});
});
