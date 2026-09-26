/**
 * Skills deployment — copies `@mainahq/skills/<name>/SKILL.md` trees into
 * `<cwd>/.agents/skills/<name>/SKILL.md`, the project location Agent
 * Skills hosts discover skills in. Besides the plugins, this is the only
 * place maina ships skills (v1 task 9.6).
 *
 * Never overwrites a user's skill: an existing `SKILL.md` is refreshed only
 * when its front matter carries maina's marker (`metadata.author: mainahq`);
 * any other file of the same name is left alone, with a warning.
 *
 * Idempotent: running twice produces byte-identical output. The copy is a
 * best-effort operation — if the skills source root isn't resolvable,
 * setup continues with a warning instead of failing.
 */

import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "@mainahq/core";

interface DeploySkillsOptions {
	/** Absolute path to the target repo. */
	cwd: string;
	/**
	 * Absolute path to the skills source root. Each immediate subdirectory
	 * is treated as a candidate skill; only those with a `SKILL.md` are
	 * copied.
	 *
	 * When omitted, the deployer tries:
	 *   1. the CLI's nested `node_modules/@mainahq/skills` (npm global, or
	 *      the workspace link in the monorepo)
	 *   2. the sibling `skills` package (monorepo, or a hoisted install)
	 *   3. node resolution of `@mainahq/skills` from this module
	 */
	sourceRoot?: string;
}

/** Where skills land, relative to the repo root. */
const SKILLS_DIR = join(".agents", "skills");

/** The `metadata.author` every maina skill carries. */
const MAINA_AUTHOR = "mainahq";

/**
 * Whether a `SKILL.md` is one maina wrote: its YAML front matter says
 * `metadata.author: mainahq`. Pure.
 */
function isMainaSkill(markdown: string): boolean {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);
	if (!match) return false;
	try {
		const fm: unknown = Bun.YAML.parse(match[1] ?? "");
		if (typeof fm !== "object" || fm === null) return false;
		const metadata = (fm as { metadata?: unknown }).metadata;
		return (
			typeof metadata === "object" &&
			metadata !== null &&
			(metadata as { author?: unknown }).author === MAINA_AUTHOR
		);
	} catch {
		return false;
	}
}

function isSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

interface DeploySkillsReport {
	/** Skill names (directory names) that were written/refreshed. */
	deployed: string[];
	/** Non-fatal diagnostics — e.g. "source root missing". */
	warnings: string[];
}

export async function deploySkills(
	opts: DeploySkillsOptions,
): Promise<Result<DeploySkillsReport>> {
	const deployed: string[] = [];
	const warnings: string[] = [];

	try {
		const source = opts.sourceRoot ?? defaultSkillsRoot();
		if (source === null) {
			warnings.push(
				"skills source not found — reinstall @mainahq/cli (it ships @mainahq/skills) or set sourceRoot",
			);
			return { ok: true, value: { deployed, warnings } };
		}
		if (!existsSync(source)) {
			warnings.push(`skills source does not exist: ${source}`);
			return { ok: true, value: { deployed, warnings } };
		}

		const entries = readdirSync(source, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			// Ignore internal dirs.
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules") continue;
			if (entry.name === "__tests__") continue;

			const srcSkill = join(source, entry.name, "SKILL.md");
			if (!existsSync(srcSkill)) continue;

			const relSkill = join(SKILLS_DIR, entry.name, "SKILL.md");
			const destSkill = join(opts.cwd, relSkill);
			const desired = readFileSync(srcSkill, "utf-8");

			// A symlink (even a dangling one, which existsSync misses) could
			// point the write outside the repo: never write through it.
			if (isSymlink(destSkill)) {
				warnings.push(
					`kept ${relSkill}: it is a symlink; maina never writes through one`,
				);
				continue;
			}

			if (existsSync(destSkill)) {
				const current = readFileSync(destSkill, "utf-8");
				if (current === desired) {
					// Already up to date — still count as "deployed" so callers
					// can display an accurate total.
					deployed.push(entry.name);
					continue;
				}
				if (!isMainaSkill(current)) {
					warnings.push(
						`kept ${relSkill}: not a maina skill (no metadata.author: ${MAINA_AUTHOR}); move it to install maina's`,
					);
					continue;
				}
			}

			mkdirSync(dirname(destSkill), { recursive: true });
			writeFileSync(destSkill, desired, "utf-8");
			deployed.push(entry.name);
		}

		return { ok: true, value: { deployed: deployed.sort(), warnings } };
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/**
 * Where the `skills` package sits for the CLI package enclosing `hereDir`.
 * From source this module sits in `cli/src/onboarding/setup`; bundled by
 * bunup it lands in a code-split chunk (`cli/dist/shared/…`). Anchoring on
 * the nearest `package.json` (the CLI package root) instead of a fixed `..`
 * count keeps every layout pointing at the same places: the CLI's own
 * nested dependency first (npm's global layout, or the workspace link in
 * the monorepo), then the sibling (`packages/skills` in the monorepo, a
 * hoisted `@mainahq/skills` in an install). Nested wins so a separately
 * installed, possibly stale global `@mainahq/skills` next to the CLI never
 * shadows the version the CLI depends on.
 */
export function skillsRootCandidates(
	hereDir: string,
	hasPackageJson: (dir: string) => boolean = (dir) =>
		existsSync(join(dir, "package.json")),
): readonly string[] {
	let dir = hereDir;
	for (;;) {
		if (hasPackageJson(dir)) {
			return [
				join(dir, "node_modules", "@mainahq", "skills"),
				join(dir, "..", "skills"),
			];
		}
		const parent = dirname(dir);
		if (parent === dir) return [];
		dir = parent;
	}
}

/**
 * Locate the `@mainahq/skills` source root. For maina devs working inside
 * the monorepo, the sibling `packages/skills` takes precedence; for
 * end-users who install `@mainahq/cli` (which depends on the skills
 * package), the candidates find it next to or inside the CLI, and node
 * resolution from this module covers any other layout. Resolution starts
 * here, not at the user's cwd, so a global install finds its own copy.
 * Returns `null` when neither is available.
 */
function defaultSkillsRoot(): string | null {
	// `fileURLToPath` handles paths with spaces or other percent-encoded
	// characters that would break `.pathname`.
	const here = fileURLToPath(import.meta.url);
	for (const guess of skillsRootCandidates(dirname(here))) {
		if (existsSync(guess) && dirHasSkills(guess)) return guess;
	}
	try {
		const require = createRequire(here);
		const root = dirname(require.resolve("@mainahq/skills/package.json"));
		if (dirHasSkills(root)) return root;
	} catch {
		// Not installed — fall through.
	}
	return null;
}

function dirHasSkills(root: string): boolean {
	try {
		const entries = readdirSync(root, { withFileTypes: true });
		for (const e of entries) {
			if (!e.isDirectory()) continue;
			const skill = join(root, e.name, "SKILL.md");
			try {
				if (statSync(skill).isFile()) return true;
			} catch {
				// continue
			}
		}
	} catch {
		return false;
	}
	return false;
}
