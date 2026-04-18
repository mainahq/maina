/**
 * `maina mcp` — install / remove / list the maina MCP server across
 * supported AI clients.
 *
 * Three subcommands:
 *   maina mcp add        — write the maina entry into each detected client's
 *                          global config (or specified --client list)
 *   maina mcp remove     — strip the maina entry from those configs
 *   maina mcp list       — show install status per client
 *
 * Inspired by `npx @posthog/wizard mcp add`. The setup wizard handles the
 * project-scope (`.mcp.json`, `.claude/settings.json`); this command is
 * the cross-project (user-global) counterpart.
 */

import { intro, log, outro } from "@clack/prompts";
import {
	type ListEntry,
	listClientIds,
	type McpClientId,
	type McpScope,
	type RunOptions,
	type RunReport,
	runAdd,
	runList,
	runRemove,
} from "@mainahq/core";
import { Command } from "commander";
import { EXIT_PASSED, outputJson } from "../json";

// ── Option parsing ─────────────────────────────────────────────────────────

const VALID_CLIENTS = new Set<McpClientId>(listClientIds());

export function parseClientList(
	raw: string | undefined,
): McpClientId[] | undefined {
	if (!raw) return undefined;
	const parts = raw
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter((s) => s.length > 0);
	const validated: McpClientId[] = [];
	for (const p of parts) {
		if (!VALID_CLIENTS.has(p as McpClientId)) {
			throw new Error(
				`Unknown client: ${p}. Valid clients: ${listClientIds().join(", ")}`,
			);
		}
		validated.push(p as McpClientId);
	}
	return validated.length > 0 ? validated : undefined;
}

export function parseScope(raw: string | undefined): McpScope {
	if (raw === undefined) return "global";
	const v = raw.toLowerCase();
	if (v === "global" || v === "project" || v === "both") return v;
	throw new Error(`Unknown scope: ${raw}. Use one of: global, project, both`);
}

// ── Pretty printing ────────────────────────────────────────────────────────

function actionEmoji(action: string): string {
	switch (action) {
		case "created":
		case "updated":
		case "removed":
			return "+";
		case "unchanged":
			return "·";
		case "absent":
			return "—";
		default:
			return "?";
	}
}

function emitAddReport(report: RunReport): void {
	for (const r of report.results) {
		const prefix = actionEmoji(r.action);
		const dry = r.dryRun ? " [dry-run]" : "";
		const err = r.error ? ` (error: ${r.error})` : "";
		log.message(
			`  ${prefix} ${r.clientId.padEnd(10)} ${r.scope.padEnd(7)}  ${r.action.padEnd(9)}  ${r.configPath}${dry}${err}`,
		);
	}
	for (const id of report.skipped) {
		log.message(
			`  · ${id.padEnd(10)} (not detected — pass --client ${id} to install anyway)`,
		);
	}
}

function emitListReport(entries: ListEntry[]): void {
	log.message("  STATUS    CLIENT      SCOPE    PATH");
	for (const e of entries) {
		const installed = e.installed
			? "✓ installed"
			: e.detected
				? "  not yet  "
				: "  no client";
		log.message(
			`  ${installed}  ${e.clientId.padEnd(10)} ${e.scope.padEnd(7)} ${e.configPath}${e.error ? ` (${e.error})` : ""}`,
		);
	}
}

// ── Action interface (testable) ────────────────────────────────────────────

export interface McpActionOptions {
	command: "add" | "remove" | "list";
	client?: string;
	scope?: string;
	dryRun?: boolean;
	yes?: boolean;
	json?: boolean;
	cwd?: string;
	home?: string;
}

export interface McpActionResult {
	command: "add" | "remove" | "list";
	report?: RunReport;
	list?: { entries: ListEntry[] };
	error?: string;
}

export async function mcpAction(
	options: McpActionOptions,
): Promise<McpActionResult> {
	const cwd = options.cwd ?? process.cwd();

	let clients: McpClientId[] | undefined;
	let scope: McpScope;
	try {
		clients = parseClientList(options.client);
		scope = parseScope(options.scope);
	} catch (e) {
		return {
			command: options.command,
			error: e instanceof Error ? e.message : String(e),
		};
	}

	const runOpts: RunOptions = {
		scope,
		dryRun: options.dryRun === true,
		cwd,
		...(clients ? { clients } : {}),
		...(options.home ? { home: options.home } : {}),
	};

	if (options.command === "add") {
		return { command: "add", report: await runAdd(runOpts) };
	}
	if (options.command === "remove") {
		return { command: "remove", report: await runRemove(runOpts) };
	}
	return { command: "list", list: await runList(runOpts) };
}

// ── Commander wiring ───────────────────────────────────────────────────────

function buildCommonOptions(c: Command): Command {
	return c
		.option(
			"--client <list>",
			"Comma-separated client IDs (default: auto-detect all)",
		)
		.option("--scope <s>", "global | project | both (default: global)")
		.option("--dry-run", "Print what would change without writing")
		.option("--json", "Machine-readable JSON output")
		.option("-y, --yes", "Skip confirmations (no-op today; reserved)");
}

export function mcpCommand(): Command {
	const cmd = new Command("mcp").description(
		"Install / remove / list the maina MCP server across AI clients",
	);

	const add = buildCommonOptions(
		new Command("add").description(
			"Install the maina MCP server in each detected client's global config",
		),
	).action(async (opts) => {
		const json = opts.json === true;
		if (!json) intro("maina mcp add");
		const result = await mcpAction({
			command: "add",
			client: opts.client,
			scope: opts.scope,
			dryRun: opts.dryRun,
			yes: opts.yes,
			json,
		});
		if (result.error) {
			if (json) outputJson({ error: result.error }, 1);
			else outro(`Failed: ${result.error}`);
			process.exitCode = 1;
			return;
		}
		if (json) {
			outputJson(result.report, EXIT_PASSED);
			return;
		}
		emitAddReport(result.report ?? { results: [], skipped: [] });
		outro("Done.");
	});

	const remove = buildCommonOptions(
		new Command("remove").description(
			"Remove the maina MCP server from each client's config",
		),
	).action(async (opts) => {
		const json = opts.json === true;
		if (!json) intro("maina mcp remove");
		const result = await mcpAction({
			command: "remove",
			client: opts.client,
			scope: opts.scope,
			dryRun: opts.dryRun,
			yes: opts.yes,
			json,
		});
		if (result.error) {
			if (json) outputJson({ error: result.error }, 1);
			else outro(`Failed: ${result.error}`);
			process.exitCode = 1;
			return;
		}
		if (json) {
			outputJson(result.report, EXIT_PASSED);
			return;
		}
		emitAddReport(result.report ?? { results: [], skipped: [] });
		outro("Done.");
	});

	const list = buildCommonOptions(
		new Command("list").description("Show maina MCP install status per client"),
	).action(async (opts) => {
		const json = opts.json === true;
		if (!json) intro("maina mcp list");
		const result = await mcpAction({
			command: "list",
			client: opts.client,
			scope: opts.scope,
			json,
		});
		if (result.error) {
			if (json) outputJson({ error: result.error }, 1);
			else outro(`Failed: ${result.error}`);
			process.exitCode = 1;
			return;
		}
		if (json) {
			outputJson(result.list, EXIT_PASSED);
			return;
		}
		emitListReport(result.list?.entries ?? []);
		outro("Done.");
	});

	cmd.addCommand(add);
	cmd.addCommand(remove);
	cmd.addCommand(list);
	return cmd;
}
