/**
 * Apply add/remove operations against a single client's config file.
 *
 * Atomic write semantics: parse the existing file (or start fresh if it
 * doesn't exist), mutate ONLY the maina entry, then write to a temp path
 * + rename. Other entries — both other MCP servers and unrelated config
 * keys — are preserved verbatim by the JSON / TOML round-trip.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import * as toml from "@iarna/toml";
import type { ApplyResult, McpClientInfo } from "./types";

// ── File format adapters ───────────────────────────────────────────────────

type Parsed = Record<string, unknown>;

function parseConfig(raw: string, format: "json" | "toml"): Parsed {
	if (raw.trim().length === 0) return {};
	if (format === "json") {
		const value = JSON.parse(raw);
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Parsed)
			: {};
	}
	return toml.parse(raw) as Parsed;
}

function serialise(value: Parsed, format: "json" | "toml"): string {
	if (format === "json") {
		return `${JSON.stringify(value, null, 2)}\n`;
	}
	return toml.stringify(value as toml.JsonMap);
}

// ── Path navigation ────────────────────────────────────────────────────────

/**
 * Walk into `root` along `path`, creating intermediate objects as needed,
 * and return the parent that holds the final container plus the final key.
 */
function getOrCreateContainer(
	root: Parsed,
	path: string[],
	container: "object" | "array",
): { parent: Parsed; key: string } {
	let cursor: Parsed = root;
	for (let i = 0; i < path.length - 1; i++) {
		const k = path[i] as string;
		const next = cursor[k];
		if (!next || typeof next !== "object" || Array.isArray(next)) {
			cursor[k] = {};
		}
		cursor = cursor[k] as Parsed;
	}
	const lastKey = path[path.length - 1] as string;
	if (cursor[lastKey] === undefined || cursor[lastKey] === null) {
		cursor[lastKey] = container === "object" ? {} : [];
	}
	return { parent: cursor, key: lastKey };
}

// ── Add / Remove core ──────────────────────────────────────────────────────

interface MutationOutcome {
	changed: boolean;
	priorState: "absent" | "present";
}

function applyAdd(root: Parsed, info: McpClientInfo): MutationOutcome {
	const { parent, key } = getOrCreateContainer(
		root,
		info.shape.path,
		info.shape.container,
	);
	const desired = info.buildEntry();

	if (info.shape.container === "object") {
		const bag = parent[key] as Record<string, unknown>;
		const existing = bag[info.shape.entryKey];
		const prior: MutationOutcome["priorState"] =
			existing === undefined ? "absent" : "present";
		if (prior === "present" && deepEqual(existing, desired)) {
			return { changed: false, priorState: prior };
		}
		bag[info.shape.entryKey] = desired;
		return { changed: true, priorState: prior };
	}

	// container = "array" (Continue legacy shape)
	const arr = parent[key] as unknown[];
	const idx = arr.findIndex(
		(e): e is { name?: unknown } =>
			typeof e === "object" &&
			e !== null &&
			(e as { name?: unknown }).name === info.shape.entryKey,
	);
	if (idx >= 0 && deepEqual(arr[idx], desired)) {
		return { changed: false, priorState: "present" };
	}
	if (idx >= 0) {
		arr[idx] = desired;
		return { changed: true, priorState: "present" };
	}
	arr.push(desired);
	return { changed: true, priorState: "absent" };
}

function applyRemove(root: Parsed, info: McpClientInfo): MutationOutcome {
	// Walk without creating; if any segment is missing, nothing to remove.
	let cursor: Parsed = root;
	for (let i = 0; i < info.shape.path.length - 1; i++) {
		const next = cursor[info.shape.path[i] as string];
		if (!next || typeof next !== "object" || Array.isArray(next)) {
			return { changed: false, priorState: "absent" };
		}
		cursor = next as Parsed;
	}
	const lastKey = info.shape.path[info.shape.path.length - 1] as string;
	const container = cursor[lastKey];
	if (container === undefined || container === null) {
		return { changed: false, priorState: "absent" };
	}

	if (info.shape.container === "object") {
		const bag = container as Record<string, unknown>;
		if (bag[info.shape.entryKey] === undefined) {
			return { changed: false, priorState: "absent" };
		}
		delete bag[info.shape.entryKey];
		return { changed: true, priorState: "present" };
	}

	const arr = container as unknown[];
	const idx = arr.findIndex(
		(e): e is { name?: unknown } =>
			typeof e === "object" &&
			e !== null &&
			(e as { name?: unknown }).name === info.shape.entryKey,
	);
	if (idx < 0) return { changed: false, priorState: "absent" };
	arr.splice(idx, 1);
	return { changed: true, priorState: "present" };
}

function deepEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

// ── Atomic file ops ────────────────────────────────────────────────────────

function readOrEmpty(path: string): string {
	if (!existsSync(path)) return "";
	return readFileSync(path, "utf-8");
}

function writeAtomic(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
	writeFileSync(tmp, content, "utf-8");
	renameSync(tmp, path);
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface RunOnClientOptions {
	configPath: string;
	scope: "global" | "project";
	dryRun: boolean;
}

export async function addOnClient(
	info: McpClientInfo,
	opts: RunOnClientOptions,
): Promise<ApplyResult> {
	const result: ApplyResult = {
		clientId: info.id,
		configPath: opts.configPath,
		scope: opts.scope,
		action: "unchanged",
		dryRun: opts.dryRun,
	};
	try {
		const raw = readOrEmpty(opts.configPath);
		const parsed = parseConfig(raw, info.configFormat);
		const outcome = applyAdd(parsed, info);

		if (!outcome.changed) {
			result.action = "unchanged";
			return result;
		}

		const wasNew = !existsSync(opts.configPath);
		result.action = wasNew ? "created" : "updated";

		if (!opts.dryRun) {
			writeAtomic(opts.configPath, serialise(parsed, info.configFormat));
		}
		return result;
	} catch (e) {
		result.action = "unchanged";
		result.error = e instanceof Error ? e.message : String(e);
		return result;
	}
}

export async function removeFromClient(
	info: McpClientInfo,
	opts: RunOnClientOptions,
): Promise<ApplyResult> {
	const result: ApplyResult = {
		clientId: info.id,
		configPath: opts.configPath,
		scope: opts.scope,
		action: "absent",
		dryRun: opts.dryRun,
	};
	try {
		if (!existsSync(opts.configPath)) {
			result.action = "absent";
			return result;
		}
		const raw = readOrEmpty(opts.configPath);
		const parsed = parseConfig(raw, info.configFormat);
		const outcome = applyRemove(parsed, info);

		if (!outcome.changed) {
			result.action = "absent";
			return result;
		}
		result.action = "removed";
		if (!opts.dryRun) {
			writeAtomic(opts.configPath, serialise(parsed, info.configFormat));
		}
		return result;
	} catch (e) {
		result.action = "unchanged";
		result.error = e instanceof Error ? e.message : String(e);
		return result;
	}
}

/**
 * Inspect a client's config without modifying it. Used by `maina mcp list`.
 */
export async function inspectClient(
	info: McpClientInfo,
	configPath: string,
): Promise<{ installed: boolean; error?: string }> {
	try {
		if (!existsSync(configPath)) return { installed: false };
		const raw = readOrEmpty(configPath);
		const parsed = parseConfig(raw, info.configFormat);
		let cursor: unknown = parsed;
		for (const segment of info.shape.path) {
			if (!cursor || typeof cursor !== "object") return { installed: false };
			cursor = (cursor as Record<string, unknown>)[segment];
		}
		if (!cursor) return { installed: false };
		if (info.shape.container === "object") {
			return {
				installed:
					(cursor as Record<string, unknown>)[info.shape.entryKey] !==
					undefined,
			};
		}
		return {
			installed: (cursor as unknown[]).some(
				(e) =>
					typeof e === "object" &&
					e !== null &&
					(e as { name?: unknown }).name === info.shape.entryKey,
			),
		};
	} catch (e) {
		return {
			installed: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
