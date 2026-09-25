/**
 * `maina mcp` — install, remove, and list the maina MCP server across
 * supported AI clients; plus the global registration `maina setup` does.
 *
 * Every entry point resolves files through `targetsFor` (./targets.ts),
 * plans pure `FileOp`s (./merge.ts, ./uninstall.ts) and carries them out
 * through the `HostFs` port (./apply.ts). Dry runs plan without applying.
 */

import { homedir, platform } from "node:os";
import { applyFileOp, type HostFs, nodeHostFs, snapshotTarget } from "./apply";
import { buildClientRegistry, listClientIds } from "./clients";
import { type FileOp, mergeEntry, readEntry, type Snapshot } from "./merge";
import {
	type PathContext,
	type TargetFile,
	targetsFor,
	wiredPerProject,
} from "./targets";
import type {
	ApplyResult,
	McpClientId,
	McpClientInfo,
	RunOptions,
} from "./types";
import { removeEntry } from "./uninstall";

export { buildClientRegistry, listClientIds } from "./clients";
export type {
	ApplyResult,
	McpClientId,
	McpScope,
	RunOptions,
} from "./types";

/**
 * Paths for this machine. Env overrides (`$CODEX_HOME`, `%APPDATA%`) only
 * apply to the real home: a test's fake home must never reach real files.
 */
export function hostPathContext(cwd: string, home?: string): PathContext {
	const real = home === undefined;
	const { CODEX_HOME, APPDATA } = process.env;
	return {
		home: home ?? homedir(),
		cwd,
		platform: platform(),
		...(real && CODEX_HOME ? { codexHome: CODEX_HOME } : {}),
		...(real && APPDATA ? { appData: APPDATA } : {}),
	};
}

export interface RunReport {
	readonly results: readonly ApplyResult[];
	readonly skipped: readonly McpClientId[];
}

interface Selected {
	readonly info: McpClientInfo;
	readonly target: TargetFile;
}

async function selectTargets(
	opts: RunOptions,
	ctx: PathContext,
): Promise<{ targets: Selected[]; skipped: McpClientId[] }> {
	const registry = buildClientRegistry(ctx);
	const explicit = opts.clients !== undefined;
	const targets: Selected[] = [];
	const skipped: McpClientId[] = [];
	for (const id of opts.clients ?? listClientIds()) {
		const info = registry[id];
		// Named clients are respected as-is; auto mode only writes to
		// clients we believe are present.
		if (!explicit && !(await info.detect())) {
			skipped.push(id);
			continue;
		}
		for (const target of targetsFor(id, opts.scope, ctx)) {
			targets.push({ info, target });
		}
	}
	return { targets, skipped };
}

/** Plan with `plan`, apply unless dry-running, report per target. */
function execute(
	selected: Selected,
	fs: HostFs,
	dryRun: boolean,
	plan: (target: TargetFile, snapshot: Snapshot) => FileOp,
): ApplyResult {
	const { info, target } = selected;
	const base = {
		clientId: info.id,
		configPath: target.path,
		scope: target.scope,
		dryRun,
	};
	const snap = snapshotTarget(fs, target);
	if (!snap.ok) return { ...base, action: "skipped", error: snap.error };
	const op = plan(target, snap.value);
	if (op.action === "skipped") {
		return { ...base, action: "skipped", error: op.reason ?? "skipped" };
	}
	if (!dryRun) {
		const applied = applyFileOp(op, fs);
		if (!applied.ok) {
			return { ...base, action: "skipped", error: applied.error };
		}
	}
	return { ...base, action: op.action };
}

export async function runAdd(
	opts: RunOptions,
	fs: HostFs = nodeHostFs(),
): Promise<RunReport> {
	const ctx = hostPathContext(opts.cwd, opts.home);
	const { targets, skipped } = await selectTargets(opts, ctx);
	const results = targets.map((s) =>
		execute(s, fs, opts.dryRun, (t, snap) =>
			mergeEntry(t, s.info.buildEntry(), snap),
		),
	);
	return { results, skipped };
}

export async function runRemove(
	opts: RunOptions,
	fs: HostFs = nodeHostFs(),
): Promise<RunReport> {
	const ctx = hostPathContext(opts.cwd, opts.home);
	const { targets, skipped } = await selectTargets(opts, ctx);
	const results = targets.map((s) => execute(s, fs, opts.dryRun, removeEntry));
	return { results, skipped };
}

interface SetupHostsOptions {
	readonly home: string;
	readonly cwd: string;
}

/**
 * The global registration `maina setup` performs: every installed host
 * that setup does not already wire through a project file (Claude Code
 * and Cursor get `.mcp.json` / `.cursor/mcp.json`) gets maina merged into
 * its global config — Codex's `config.toml`, Windsurf, Zed, …
 */
export async function runSetupHosts(
	opts: SetupHostsOptions,
	fs: HostFs = nodeHostFs(),
): Promise<RunReport> {
	const clients = listClientIds().filter((id) => !wiredPerProject(id));
	const ctx = hostPathContext(opts.cwd, opts.home);
	const registry = buildClientRegistry(ctx);
	const detected: McpClientId[] = [];
	for (const id of clients) {
		if (await registry[id].detect()) detected.push(id);
	}
	return runAdd(
		{
			clients: detected,
			scope: "global",
			dryRun: false,
			cwd: opts.cwd,
			home: opts.home,
		},
		fs,
	);
}

export interface ListEntry {
	readonly clientId: McpClientId;
	readonly label: string;
	readonly scope: "global" | "project";
	readonly configPath: string;
	readonly detected: boolean;
	readonly installed: boolean;
	readonly error?: string;
}

export async function runList(
	opts: RunOptions,
	fs: HostFs = nodeHostFs(),
): Promise<{ entries: ListEntry[] }> {
	const ctx = hostPathContext(opts.cwd, opts.home);
	const registry = buildClientRegistry(ctx);
	const entries: ListEntry[] = [];
	for (const id of opts.clients ?? listClientIds()) {
		const info = registry[id];
		const detected = await info.detect();
		// A host without a project file has no project row, rather than
		// its global path mislabelled `project`.
		for (const t of targetsFor(id, opts.scope, ctx)) {
			const base = {
				clientId: id,
				label: info.label,
				scope: t.scope,
				configPath: t.path,
				detected,
			};
			const text = fs.read(t.path);
			if (!text.ok) {
				entries.push({ ...base, installed: false, error: text.error });
				continue;
			}
			const found =
				text.value === null
					? { ok: true as const, value: undefined }
					: readEntry(t, text.value);
			entries.push(
				found.ok
					? { ...base, installed: found.value !== undefined }
					: { ...base, installed: false, error: found.reason },
			);
		}
	}
	return { entries };
}
