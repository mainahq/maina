/**
 * Skills deployment — copies `@mainahq/skills/<name>/SKILL.md` trees into
 * `<cwd>/.maina/skills/<name>/SKILL.md` so the user's agent can discover
 * them.
 *
 * Idempotent: running twice produces byte-identical output. The copy is a
 * best-effort operation — if the skills source root isn't resolvable,
 * setup continues with a warning instead of failing.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../db/index";

export interface DeploySkillsOptions {
	/** Absolute path to the target repo. */
	cwd: string;
	/**
	 * Absolute path to the skills source root. Each immediate subdirectory
	 * is treated as a candidate skill; only those with a `SKILL.md` are
	 * copied.
	 *
	 * When omitted, the deployer tries:
	 *   1. `node_modules/@mainahq/skills` (installed-from-npm case)
	 *   2. the monorepo sibling `../../skills` relative to this file
	 */
	sourceRoot?: string;
}

export interface DeploySkillsReport {
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
				"skills source not found — install @mainahq/skills or set sourceRoot",
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

			const destDir = join(opts.cwd, ".maina/skills", entry.name);
			const destSkill = join(destDir, "SKILL.md");
			const desired = readFileSync(srcSkill, "utf-8");

			if (existsSync(destSkill)) {
				const current = readFileSync(destSkill, "utf-8");
				if (current === desired) {
					// Already up to date — still count as "deployed" so callers
					// can display an accurate total.
					deployed.push(entry.name);
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
 * Locate the `@mainahq/skills` source root. For maina devs working inside
 * the monorepo, the sibling `packages/skills` takes precedence; for
 * end-users who `bun add -g @mainahq/cli`, the monorepo guess misses and
 * we resolve the installed package via `Bun.resolveSync`. Returns `null`
 * when neither is available.
 */
function defaultSkillsRoot(): string | null {
	// 1. Monorepo sibling — `fileURLToPath` handles paths with spaces or
	// other percent-encoded characters that would break `.pathname`.
	const hereDir = dirname(fileURLToPath(import.meta.url));
	const monorepoGuess = join(hereDir, "..", "..", "..", "skills");
	if (existsSync(monorepoGuess) && dirHasSkills(monorepoGuess)) {
		return monorepoGuess;
	}

	// 2. Resolve via node module lookup. Bun's resolver throws when the
	// module isn't installed; we try a known sub-path so we get the
	// directory back reliably.
	try {
		// biome-ignore lint/suspicious/noExplicitAny: accessing Bun resolver
		const bun = (globalThis as any).Bun;
		if (bun && typeof bun.resolveSync === "function") {
			const pkgJson = bun.resolveSync(
				"@mainahq/skills/package.json",
				process.cwd(),
			);
			const root = dirname(pkgJson);
			if (dirHasSkills(root)) return root;
		}
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
