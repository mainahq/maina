/**
 * Uninstall maina from a host's config files (FR-INS-4).
 *
 * The goal is the pre-maina state, exactly:
 * - when the file still equals "backup + maina's entry", the backup's
 *   bytes are put back verbatim and the backup is dropped;
 * - when maina created the file (no backup) and nothing else was added,
 *   the file is deleted again;
 * - otherwise the user changed the file after install, so only maina's
 *   entry is removed and their edits are kept.
 *
 * Pure: file contents come in through the `read` port.
 */

import {
	deleteEntry,
	type FileOp,
	isEmptyConfig,
	readEntry,
	type Snapshot,
	setEntry,
} from "./merge";
import { type PathContext, type TargetFile, targetsFor } from "./targets";
import type { McpClientId, McpScope } from "./types";

/** Plan removing maina's entry from one target. */
export function removeEntry(target: TargetFile, snapshot: Snapshot): FileOp {
	const { path, backupPath } = target;
	const text = snapshot.text;
	if (text === null) return { path, action: "absent" };
	const current = readEntry(target, text);
	if (!current.ok) return { path, action: "skipped", reason: current.reason };
	if (current.value === undefined) return { path, action: "absent" };

	const backup = snapshot.backup;
	if (backup !== null) {
		const before = readEntry(target, backup);
		const reinstalled =
			before.ok && before.value === undefined
				? setEntry(target, backup, current.value)
				: null;
		if (reinstalled?.ok === true && reinstalled.text === text) {
			return {
				path,
				action: "restored",
				content: backup,
				dropBackup: backupPath,
			};
		}
	}

	const next = deleteEntry(target, text);
	if (!next.ok) return { path, action: "skipped", reason: next.reason };
	if (backup === null && isEmptyConfig(target, next.text)) {
		return { path, action: "removed", content: null };
	}
	return {
		path,
		action: "removed",
		content: next.text,
		// A stale backup would be restored over the user's later edits.
		...(backup !== null ? { dropBackup: backupPath } : {}),
	};
}

/** Plan removing maina from every config file `host` reads for `scope`. */
export function uninstall(
	host: McpClientId,
	scope: McpScope,
	ctx: PathContext,
	read: (target: TargetFile) => Snapshot,
): readonly FileOp[] {
	return targetsFor(host, scope, ctx).map((t) => removeEntry(t, read(t)));
}
