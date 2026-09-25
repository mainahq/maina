/**
 * Migration from maina 1.x (FR-INS-8).
 *
 * 1.x registered the MCP server as a package-runner launch —
 * `bunx @mainahq/cli --mcp`, `npx @mainahq/cli@1.6.1 --mcp` — in every
 * agent's config, including `.claude/settings.json`, which Claude Code
 * never reads. Those launches break under a GUI host's stripped PATH (P2)
 * and on unpublished pins (P3). This module finds every such stale entry in
 * every location maina knows about and:
 * - in a file a host reads, rewrites the entry's launch to the one maina
 *   writes today, keeping the entry's shape and its other fields (`env`,
 *   `type`, `disabled`, …);
 * - in a file no host reads, removes the entry, and deletes the file when
 *   nothing but empty containers is left.
 *
 * Nothing else is touched: the constitution, custom prompts, databases and
 * every other key and server are kept. Each changed file is first copied to
 * its backup path (an existing backup is never replaced). Running it again
 * changes nothing, and the report lists every change it made.
 *
 * Everything but `migrate1x` is pure; `migrate1x` carries the plan out
 * through the `HostFs` port.
 */

import { basename, join, relative } from "node:path";
import { applyFileOp, type HostFs, snapshotTarget } from "../hosts/apply";
import { listClientIds } from "../hosts/clients";
import { launchSpecOf } from "../hosts/health";
import type { Launcher } from "../hosts/launcher";
import {
	deleteEntry,
	type FileOp,
	isEmptyConfig,
	readEntry,
	type Snapshot,
	setEntry,
} from "../hosts/merge";
import {
	type EntryShape,
	ignoredTargets,
	type PathContext,
	type TargetScope,
	targetsFor,
} from "../hosts/targets";
import { LEGACY_TARGETS } from "./legacy";

// ── Types ────────────────────────────────────────────────────────────────────

/** One place a 1.x install may have left a maina entry. */
interface MigrationTarget extends EntryShape {
	/** Host (or retired agent) the file belongs to, for the report. */
	readonly label: string;
	readonly scope: TargetScope;
	/** Absolute path of the config file. */
	readonly path: string;
	/** Where the pre-migration copy of `path` is kept. */
	readonly backupPath: string;
	/** True when a host reads this file: rewrite the entry, never drop it. */
	readonly live: boolean;
}

type MigrationAction = "rewritten" | "removed" | "deleted";

interface MigrationChange {
	readonly label: string;
	readonly scope: TargetScope;
	readonly path: string;
	readonly action: MigrationAction;
	/** The stale launch, as a command line. */
	readonly from: string;
	/** The launch written instead; null when the entry was dropped. */
	readonly to: string | null;
	/** Backup holding the file as it was before maina first changed it. */
	readonly backup: string;
}

interface MigrationSkip {
	readonly path: string;
	readonly reason: string;
}

export interface MigrationReport {
	readonly changes: readonly MigrationChange[];
	readonly skipped: readonly MigrationSkip[];
}

type MigrationStep =
	| { readonly kind: "none" }
	| { readonly kind: "skip"; readonly reason: string }
	| {
			readonly kind: "change";
			readonly op: FileOp;
			readonly action: MigrationAction;
			readonly from: string;
			readonly to: string | null;
	  };

type Obj = Readonly<Record<string, unknown>>;

// ── Stale launches ──────────────────────────────────────────────────────────

const PACKAGE_RUNNERS = new Set(["bunx", "npx"]);
const MAINA_PACKAGE = /^@mainahq\/cli(@[^\s/]+)?$/;

function isObj(v: unknown): v is Obj {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `npx`, `/x/bunx`, `C:\nodejs\npx.cmd` → the runner's bare name. */
function commandName(command: string): string {
	return basename(command.replaceAll("\\", "/"))
		.toLowerCase()
		.replace(/\.(cmd|exe|ps1)$/, "");
}

function commandLine(command: string, args: readonly string[]): string {
	return [command, ...args].join(" ");
}

/**
 * True when `entry` launches the MCP server through `bunx`/`npx
 * @mainahq/cli --mcp` (any pin) and is not the launch maina writes today.
 * Reads the stdio shape most hosts use, Zed's nested `command` and
 * Continue's `transport`.
 */
export function isStaleLaunch(entry: unknown, current: Launcher): boolean {
	const spec = launchSpecOf(entry);
	if (!spec.ok) return false;
	const { command, args } = spec.value;
	if (commandLine(command, args) === commandLine(current.command, current.args))
		return false;
	return (
		PACKAGE_RUNNERS.has(commandName(command)) &&
		args.includes("--mcp") &&
		args.some((a) => MAINA_PACKAGE.test(a))
	);
}

/** `entry` launching `launcher`, in the entry's own shape. */
function withLaunch(entry: Obj, launcher: Launcher): Obj {
	const args = [...launcher.args];
	if (isObj(entry.transport)) {
		return {
			...entry,
			transport: { ...entry.transport, command: launcher.command, args },
		};
	}
	if (isObj(entry.command)) {
		return {
			...entry,
			command: { ...entry.command, path: launcher.command, args },
		};
	}
	return { ...entry, command: launcher.command, args };
}

// ── Locations ───────────────────────────────────────────────────────────────

/**
 * Every place maina knows a 1.x install wrote an entry: each host's config
 * files, Claude Code's local scope for this repo (`projects[cwd]` in
 * `~/.claude.json`), the retired agents' MCP files (`.roo/`, `.amazonq/`,
 * `.continue/mcpServers/`) and the files hosts ignore. `project` scope
 * stays inside the repository.
 */
export function migrationTargets(
	ctx: PathContext,
	scope: "project" | "both",
): readonly MigrationTarget[] {
	const inScope = (s: TargetScope) => scope === "both" || s === "project";
	const hosts = listClientIds().flatMap((host) =>
		targetsFor(host, scope, ctx).map(
			(t): MigrationTarget => ({ ...t, label: host, live: true }),
		),
	);
	const claudeLocal = targetsFor("claude", scope, ctx)
		.filter((t) => t.scope === "global")
		.map(
			(t): MigrationTarget => ({
				...t,
				containerPath: ["projects", ctx.cwd, ...t.containerPath],
				label: "claude (local scope)",
				live: true,
			}),
		);
	const retired = LEGACY_TARGETS.flatMap((spec): MigrationTarget[] => {
		if (spec.format !== "json-key") return [];
		const entryKey = spec.keyPath[spec.keyPath.length - 1];
		if (entryKey === undefined) return [];
		return [
			{
				label: spec.path.split("/")[0]?.replace(/^\./, "") ?? spec.path,
				scope: "project",
				path: join(ctx.cwd, ...spec.path.split("/")),
				format: "json",
				containerPath: spec.keyPath.slice(0, -1),
				container: "object",
				entryKey,
				backupPath: join(ctx.cwd, ".maina", "backups", ...spec.path.split("/")),
				live: true,
			},
		];
	});
	const ignored = listClientIds().flatMap((host) =>
		ignoredTargets(host, ctx)
			.filter((t) => inScope(t.scope))
			.map(
				(t): MigrationTarget => ({
					...t,
					label: `${host} (ignored file)`,
					live: false,
				}),
			),
	);
	return [...hosts, ...claudeLocal, ...retired, ...ignored];
}

// ── Planning ────────────────────────────────────────────────────────────────

/** What migrating one target means for its current bytes. Pure. */
function planMigration(
	target: MigrationTarget,
	snapshot: Snapshot,
	launcher: Launcher,
): MigrationStep {
	const text = snapshot.text;
	if (text === null) return { kind: "none" };
	const found = readEntry(target, text);
	if (!found.ok) {
		// Only worth a word when the file may hold a 1.x launch.
		return text.includes("@mainahq/cli")
			? { kind: "skip", reason: found.reason }
			: { kind: "none" };
	}
	const entry = found.value;
	if (!isObj(entry) || !isStaleLaunch(entry, launcher)) return { kind: "none" };
	const spec = launchSpecOf(entry);
	const from = spec.ok ? commandLine(spec.value.command, spec.value.args) : "";
	const backup =
		snapshot.backup === null
			? { backup: { path: target.backupPath, content: text } }
			: {};

	if (target.live) {
		const next = setEntry(target, text, withLaunch(entry, launcher));
		if (!next.ok) return { kind: "skip", reason: next.reason };
		return {
			kind: "change",
			op: {
				path: target.path,
				action: "updated",
				content: next.text,
				...backup,
			},
			action: "rewritten",
			from,
			to: commandLine(launcher.command, launcher.args),
		};
	}
	const next = deleteEntry(target, text);
	if (!next.ok) return { kind: "skip", reason: next.reason };
	const empty = isEmptyConfig(target, next.text);
	return {
		kind: "change",
		op: {
			path: target.path,
			action: "removed",
			content: empty ? null : next.text,
			...backup,
		},
		action: empty ? "deleted" : "removed",
		from,
		to: null,
	};
}

// ── Running ─────────────────────────────────────────────────────────────────

interface Migrate1xInput {
	readonly ctx: PathContext;
	/** `project` never touches files outside the repository. */
	readonly scope: "project" | "both";
	/** The launch maina writes today (`detectLauncher()`). */
	readonly launcher: Launcher;
	readonly fs: HostFs;
}

/**
 * Migrate every target in turn. Each target is read right before it is
 * planned, so two entries in one file (`~/.claude.json`) are both kept.
 */
export function migrate1x(input: Migrate1xInput): MigrationReport {
	const changes: MigrationChange[] = [];
	const skipped: MigrationSkip[] = [];
	for (const target of migrationTargets(input.ctx, input.scope)) {
		const snap = snapshotTarget(input.fs, target);
		if (!snap.ok) {
			skipped.push({ path: target.path, reason: snap.error });
			continue;
		}
		const step = planMigration(target, snap.value, input.launcher);
		if (step.kind === "none") continue;
		if (step.kind === "skip") {
			skipped.push({ path: target.path, reason: step.reason });
			continue;
		}
		const applied = applyFileOp(step.op, input.fs);
		if (!applied.ok) {
			skipped.push({ path: target.path, reason: applied.error });
			continue;
		}
		changes.push({
			label: target.label,
			scope: target.scope,
			path: target.path,
			action: step.action,
			from: step.from,
			to: step.to,
			backup: target.backupPath,
		});
	}
	return { changes, skipped };
}

/** One line per change, for the setup log. */
export function describeMigrationChange(
	change: MigrationChange,
	cwd: string,
): string {
	const rel = relative(cwd, change.path);
	const where = rel.startsWith("..") ? change.path : rel;
	switch (change.action) {
		case "rewritten":
			return `1.x migration: ${where} now launches \`${change.to}\` (was \`${change.from}\`)`;
		case "removed":
			return `1.x migration: removed \`${change.from}\` from ${where} (no host reads it)`;
		case "deleted":
			return `1.x migration: deleted ${where}, which held only \`${change.from}\``;
		default: {
			const unreachable: never = change.action;
			return unreachable;
		}
	}
}
