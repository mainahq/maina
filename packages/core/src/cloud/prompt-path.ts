/**
 * Guard for the cloud's `PromptRecord.path` (#662).
 *
 * `maina sync pull` writes each record to `.maina/prompts/<path>`, and the
 * path comes from the server, so it is untrusted input: joined as-is, a
 * `../../x` or an absolute path would write anywhere the user can. The
 * server rejects unsafe names too; this is the client's own line of
 * defence. Pure string work; symlinks are the caller's (file-system) job.
 */

import { isAbsolute, relative } from "node:path";
import type { Result } from "../db/index";

/**
 * A single flat markdown file name. Everything that could name another
 * directory is out: separators (`/`, `\`), `..` anywhere, `:` (Windows
 * drives such as `C:x`, and NTFS alternate data streams), control
 * characters (NUL truncation), leading or trailing whitespace, and Windows
 * device names (`CON`, `NUL`, `COM1`, ...). Without
 * separators, absolute, UNC (`\\server\share`) and device (`\\?\`) forms
 * cannot occur either.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
const UNSAFE = /[/\\:\u0000-\u001f\u007f]|\.\./;
const MARKDOWN_FILE = /^\S(?:.*\S)?\.md$/;
/**
 * Windows reserved device names. Whatever the extension, `CON.md` opens the
 * console and `COM1.md` a serial port instead of a file, so they are refused
 * on every platform (teammates pull the same records).
 */
const WINDOWS_DEVICE =
	/^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])\s*(?:\.|$)/i;

/**
 * Why a cloud-supplied prompt path was refused. Data, not text: the CLI
 * edge formats it (and escapes `path`, which may hold control characters).
 */
export type PromptPathError =
	| { readonly kind: "not-a-string"; readonly type: string }
	| { readonly kind: "unsafe-name"; readonly path: string };

/**
 * The prompt's file name inside `.maina/prompts/`, or an error when the
 * cloud-supplied `path` could resolve anywhere else. Takes `unknown`
 * because the record is untyped JSON from the network.
 */
export function promptFileName(path: unknown): Result<string, PromptPathError> {
	if (typeof path !== "string") {
		// Only its type: `String()` throws on a null-prototype object.
		return { ok: false, error: { kind: "not-a-string", type: typeof path } };
	}
	if (
		UNSAFE.test(path) ||
		WINDOWS_DEVICE.test(path) ||
		!MARKDOWN_FILE.test(path)
	) {
		return { ok: false, error: { kind: "unsafe-name", path } };
	}
	return { ok: true, value: path };
}

/**
 * True when `child` lies strictly inside `dir` (both absolute, already
 * resolved). Uses the platform's path rules, so it holds on Windows too.
 */
export function isPathWithin(dir: string, child: string): boolean {
	const rel = relative(dir, child);
	return (
		rel.length > 0 &&
		rel !== ".." &&
		!rel.startsWith("../") &&
		!rel.startsWith("..\\") &&
		!isAbsolute(rel)
	);
}
