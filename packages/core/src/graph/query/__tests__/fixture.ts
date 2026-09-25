/**
 * A small repo with a known call chain, indexed into an in-memory store:
 *
 *   app -> top -> mid -> base        other (unrelated)
 *
 * and one test per link: `base > adds one` calls base, `mid > doubles` calls
 * mid, `app > runs` calls app. Nothing tests `top` directly.
 *
 * The sources live in `fixtures/repo/<path>.txt` (the `.txt` keeps tooling
 * from treating them as project code).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRepo, ROOT, unwrap } from "../../store/__tests__/helpers";
import { indexRepo } from "../../store/index";

const PATHS = [
	"src/core.ts",
	"src/mid.ts",
	"src/top.ts",
	"src/app.ts",
	"src/other.ts",
	"src/core.test.ts",
	"src/mid.test.ts",
	"src/app.test.ts",
] as const;

type FixturePath = (typeof PATHS)[number];

export const FILES: Readonly<Record<FixturePath, string>> = Object.fromEntries(
	PATHS.map((path) => [
		path,
		readFileSync(
			join(import.meta.dir, "fixtures", "repo", `${path}.txt`),
			"utf8",
		),
	]),
) as Record<FixturePath, string>;

export { ROOT, unwrap };

export async function indexedRepo(
	files: Readonly<Record<string, string>> = FILES,
): Promise<ReturnType<typeof createRepo>> {
	const repo = createRepo(files);
	unwrap(await indexRepo(repo.ports, ROOT));
	return repo;
}
