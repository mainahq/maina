/**
 * `maina mcp` — install, remove, and list the maina MCP server across
 * supported AI clients.
 *
 * Public entry points: `runAdd`, `runRemove`, `runList`. Each takes a
 * RunOptions describing the requested clients, scope, dry-run mode, and
 * cwd. Each returns a per-client list of ApplyResult / status records.
 */

import { addOnClient, inspectClient, removeFromClient } from "./apply";
import { buildClientRegistry, listClientIds } from "./clients";
import type { ApplyResult, McpClientId, RunOptions } from "./types";

export { buildClientRegistry, listClientIds } from "./clients";
export type { ApplyResult, McpClientId, McpScope, RunOptions } from "./types";

interface ResolvedClient {
	id: McpClientId;
	configPath: string;
	scope: "global" | "project";
}

async function selectClients(
	opts: RunOptions,
): Promise<{ targets: ResolvedClient[]; skipped: McpClientId[] }> {
	const registry = buildClientRegistry(opts.home);
	const requested = opts.clients ?? listClientIds();
	const targets: ResolvedClient[] = [];
	const skipped: McpClientId[] = [];

	for (const id of requested) {
		const info = registry[id];
		// When the user explicitly named clients, respect the choice and
		// skip detection. Auto-mode (no --client list) only writes to
		// clients we believe are present.
		const explicit = opts.clients !== undefined;
		if (!explicit) {
			const installed = await info.detect();
			if (!installed) {
				skipped.push(id);
				continue;
			}
		}
		if (opts.scope === "global" || opts.scope === "both") {
			targets.push({
				id,
				configPath: info.globalConfigPath(),
				scope: "global",
			});
		}
		if (
			(opts.scope === "project" || opts.scope === "both") &&
			info.projectConfigPath
		) {
			targets.push({
				id,
				configPath: info.projectConfigPath(opts.cwd),
				scope: "project",
			});
		}
	}
	return { targets, skipped };
}

export interface RunReport {
	results: ApplyResult[];
	skipped: McpClientId[];
}

export async function runAdd(opts: RunOptions): Promise<RunReport> {
	const registry = buildClientRegistry(opts.home);
	const { targets, skipped } = await selectClients(opts);
	const results: ApplyResult[] = [];
	for (const t of targets) {
		const info = registry[t.id];
		results.push(
			await addOnClient(info, {
				configPath: t.configPath,
				scope: t.scope,
				dryRun: opts.dryRun,
			}),
		);
	}
	return { results, skipped };
}

export async function runRemove(opts: RunOptions): Promise<RunReport> {
	const registry = buildClientRegistry(opts.home);
	const { targets, skipped } = await selectClients(opts);
	const results: ApplyResult[] = [];
	for (const t of targets) {
		const info = registry[t.id];
		results.push(
			await removeFromClient(info, {
				configPath: t.configPath,
				scope: t.scope,
				dryRun: opts.dryRun,
			}),
		);
	}
	return { results, skipped };
}

export interface ListEntry {
	clientId: McpClientId;
	label: string;
	scope: "global" | "project";
	configPath: string;
	detected: boolean;
	installed: boolean;
	error?: string;
}

export async function runList(
	opts: RunOptions,
): Promise<{ entries: ListEntry[] }> {
	const registry = buildClientRegistry(opts.home);
	const requested = opts.clients ?? listClientIds();
	const entries: ListEntry[] = [];
	for (const id of requested) {
		const info = registry[id];
		const detected = await info.detect();
		const scopes: Array<"global" | "project"> =
			opts.scope === "both"
				? ["global", "project"]
				: opts.scope === "project"
					? ["project"]
					: ["global"];
		for (const scope of scopes) {
			const path =
				scope === "project" && info.projectConfigPath
					? info.projectConfigPath(opts.cwd)
					: info.globalConfigPath();
			const status = await inspectClient(info, path);
			entries.push({
				clientId: id,
				label: info.label,
				scope,
				configPath: path,
				detected,
				installed: status.installed,
				...(status.error ? { error: status.error } : {}),
			});
		}
	}
	return { entries };
}
