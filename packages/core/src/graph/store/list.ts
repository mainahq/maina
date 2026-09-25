/**
 * Which files a full index covers: every file a grammar reads, as git sees
 * the working tree (tracked plus untracked, minus ignored). Outside a git
 * repository the filesystem is walked instead, skipping dependency, build
 * and hidden directories.
 */

import { posix } from "node:path";
import type { Result } from "../../db/index";
import type { FsPort, GitPort } from "../../ports/index";
import { detectLang } from "../parse/languages";

type ListError = Readonly<{ path: string; message: string }>;

const GIT_LIST = [
	"ls-files",
	"-z",
	"--cached",
	"--others",
	"--exclude-standard",
];

const SKIP_DIRS: ReadonlySet<string> = new Set([
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	"target",
	"vendor",
	"__pycache__",
	"venv",
]);

const indexable = (path: string): boolean => detectLang(path) !== null;

async function walk(
	fs: FsPort,
	root: string,
	dir: string,
	out: string[],
): Promise<Result<void, ListError>> {
	const entries = await fs.readDir(dir === "" ? root : posix.join(root, dir));
	if (!entries.ok) {
		return dir === ""
			? {
					ok: false,
					error: {
						path: root,
						message: `cannot list ${root}: ${entries.error.kind}`,
					},
				}
			: { ok: true, value: undefined };
	}
	for (const name of entries.value) {
		if (name.startsWith(".")) continue;
		const rel = dir === "" ? name : `${dir}/${name}`;
		const children = await fs.readDir(posix.join(root, rel));
		if (children.ok) {
			if (SKIP_DIRS.has(name)) continue;
			const walked = await walk(fs, root, rel, out);
			if (!walked.ok) return walked;
		} else if (indexable(rel)) {
			out.push(rel);
		}
	}
	return { ok: true, value: undefined };
}

/** Repo-relative `/`-separated paths of every indexable file under `root`, sorted. */
export async function listIndexable(
	ports: Readonly<{ fs: FsPort; git: GitPort }>,
	root: string,
): Promise<Result<readonly string[], ListError>> {
	const listed = await ports.git.run(root, GIT_LIST);
	if (listed.ok) {
		const paths = listed.value
			.split("\0")
			.map((p) => posix.normalize(p.replaceAll("\\", "/")))
			.filter((p) => p !== "." && p !== "" && indexable(p));
		return { ok: true, value: [...new Set(paths)].sort() };
	}
	const out: string[] = [];
	const walked = await walk(ports.fs, root, "", out);
	return walked.ok ? { ok: true, value: out.sort() } : walked;
}
