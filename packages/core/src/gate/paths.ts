/**
 * Path resolution for the gate. Pure string work over POSIX paths: nothing
 * touches the file system, so symlinks are not followed here (a later stage
 * with an fs port can resolve them).
 */

import { isAbsolute, normalize, resolve } from "node:path";

/** Literal shell spellings of the home directory. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: these are shell tokens, not a JS template.
const HOME_WORDS: readonly string[] = ["~", "$HOME", "${HOME}"];

/**
 * Expands a leading home spelling. With an unknown home the `~` form is kept,
 * which is never inside a workspace, so unknown stays outside (fail closed).
 */
function expandHome(path: string, home: string | undefined): string {
	for (const w of HOME_WORDS) {
		if (path === w || path.startsWith(`${w}/`)) {
			const rest = path.slice(w.length);
			return home === undefined ? `~${rest}` : `${home}${rest}`;
		}
	}
	return path;
}

/**
 * Absolute, normalised form of `path`. Returns null when the path is relative
 * and the working directory is unknown (after a `cd "$X"`).
 */
export function resolvePath(
	path: string,
	cwd: string | null,
	home: string | undefined,
): string | null {
	const expanded = expandHome(path, home);
	if (expanded.startsWith("~")) return normalize(expanded);
	if (isAbsolute(expanded)) return normalize(expanded);
	return cwd === null ? null : resolve(cwd, expanded);
}

export function isInside(path: string, dir: string): boolean {
	const d = dir.length > 1 && dir.endsWith("/") ? dir.slice(0, -1) : dir;
	if (d === "/") return path.startsWith("/");
	return path === d || path.startsWith(`${d}/`);
}

/** Temp directories: writes and deletes there are scratch work, not "outside". */
const SCRATCH_ROOTS: readonly string[] = [
	"/tmp",
	"/private/tmp",
	"/var/tmp",
	"/var/folders",
	"/private/var/folders",
	"/dev/shm",
];

export function isScratchPath(path: string): boolean {
	return SCRATCH_ROOTS.some((root) => isInside(path, root));
}

/** Pseudo-devices a write to is harmless. */
const SAFE_DEVICES: ReadonlySet<string> = new Set([
	"/dev/null",
	"/dev/stdout",
	"/dev/stderr",
	"/dev/stdin",
	"/dev/tty",
	"/dev/zero",
	"/dev/random",
	"/dev/urandom",
]);

export function isSafeDevice(path: string): boolean {
	return SAFE_DEVICES.has(path) || path.startsWith("/dev/fd/");
}

/** Disks and partitions: writing one destroys a file system. */
const BLOCK_DEVICE =
	/^\/dev\/(r?disk\d|sd[a-z]|hd[a-z]|vd[a-z]|xvd[a-z]|nvme\d|mmcblk\d|md\d|dm-\d|mapper\/|loop\d)/;

export function isBlockDevice(path: string): boolean {
	return BLOCK_DEVICE.test(path);
}
