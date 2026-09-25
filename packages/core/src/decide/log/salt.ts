/**
 * The decision log's per-repo salt (FR-DEC-5). Input, schema and option
 * hashes are keyed by it, so someone holding a list of the repo's files
 * cannot tell which path a logged hash stands for. The salt is random,
 * created on first use under `.maina/private/` (which ignores itself in
 * git) and never leaves the machine.
 *
 * Losing the salt only means new records stop matching old ones on
 * `inputHash`; nothing is decrypted with it.
 */

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Result } from "../../db/index";
import type { Policy } from "../../policy/schema";
import type { FsError, FsPort } from "../../ports/fs";
import type { DecisionLogPrivacy } from "./schema";

/** The salt file, relative to the repo root. */
export const LOG_SALT_PATH = ".maina/private/log-salt";

/** Keeps everything under `.maina/private/` out of git in any repo. */
export const LOG_SALT_GITIGNORE = ".maina/private/.gitignore";

const SALT_PATTERN = /^[0-9a-f]{64}$/;

export type LogSaltError =
	| FsError
	| Readonly<{ kind: "invalid_salt"; path: string; message: string }>;

function randomSalt(): string {
	return randomBytes(32).toString("hex");
}

async function readSalt(
	fs: FsPort,
	path: string,
): Promise<Result<string | undefined, LogSaltError>> {
	const read = await fs.readFile(path);
	if (!read.ok) {
		return read.error.kind === "not_found"
			? { ok: true, value: undefined }
			: read;
	}
	const salt = read.value.trim();
	return SALT_PATTERN.test(salt)
		? { ok: true, value: salt }
		: {
				ok: false,
				error: {
					kind: "invalid_salt",
					path,
					message:
						"the decision log salt must be 64 lower-case hex characters; restore it or delete the file to start a new one",
				},
			};
}

/**
 * The repo's log salt, created on first use. A malformed salt file is an
 * error rather than silently replaced, since replacing it would break
 * replay against every earlier record. After creating one the file is read
 * back, so two processes racing to create it settle on the same salt.
 */
export async function loadLogSalt(
	ports: Readonly<{ fs: FsPort }>,
	root: string,
	generate: () => string = randomSalt,
): Promise<Result<string, LogSaltError>> {
	const path = join(root, LOG_SALT_PATH);
	const existing = await readSalt(ports.fs, path);
	if (!existing.ok) return existing;
	if (existing.value !== undefined) return { ok: true, value: existing.value };
	const ignored = await ports.fs.writeFile(
		join(root, LOG_SALT_GITIGNORE),
		"*\n",
	);
	if (!ignored.ok) return ignored;
	const written = await ports.fs.writeFile(path, `${generate()}\n`);
	if (!written.ok) return written;
	const stored = await readSalt(ports.fs, path);
	if (!stored.ok) return stored;
	return stored.value === undefined
		? {
				ok: false,
				error: { kind: "io", path, message: "the new salt was not stored" },
			}
		: { ok: true, value: stored.value };
}

/** The log privacy `policy` asks for, keyed by the repo's `salt`. */
export function logPrivacy(policy: Policy, salt?: string): DecisionLogPrivacy {
	const rawOptions = policy.log.paths === "plain";
	return salt === undefined ? { rawOptions } : { rawOptions, salt };
}
