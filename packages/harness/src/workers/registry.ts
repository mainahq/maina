/**
 * Worker registry (FR-HAR-1, FR-HAR-7): the coding agents the harness can
 * drive and how to launch each one.
 *
 * `resolveWorker("codex")` finds the agent's ACP adapter on PATH, checks it
 * against the pinned minimum (`versions.ts`) and returns the spec
 * `startRun` launches. `resolveWorker("headless:codex")` resolves the
 * agent's print-mode fallback instead, marked `sandbox-only`: an ACP worker
 * is never silently swapped for one the gate cannot stop. A missing or
 * outdated agent is an error carrying the command that fixes it.
 */

import type { Result } from "@mainahq/core";
import { claude } from "./claude";
import { codex } from "./codex";
import { cursor } from "./cursor";
import { gemini } from "./gemini";
import { HEADLESS_PREFIX, headlessSpec } from "./headless";
import { opencode } from "./opencode";
import { systemProbe, type WorkerProbe } from "./probe";
import type {
	LaunchMode,
	WorkerDefinition,
	WorkerError,
	WorkerName,
	WorkerSpec,
} from "./spec";
import { MIN_ADAPTER_VERSIONS } from "./versions";

export type { WorkerSpec } from "./spec";

const DEFINITIONS: Readonly<Record<WorkerName, WorkerDefinition>> = {
	claude,
	codex,
	cursor,
	gemini,
	opencode,
};

export const WORKER_NAMES = Object.keys(DEFINITIONS) as readonly WorkerName[];

const isWorkerName = (name: string): name is WorkerName =>
	Object.hasOwn(DEFINITIONS, name);

/** The first dotted number in `--version` output: `codex-acp 1.13.1` → `1.13.1`. */
function parseVersion(output: string | null): string | undefined {
	return output?.match(/\d+(?:\.\d+)+/)?.[0];
}

/** Numeric, part by part; a missing part counts as 0. */
function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function locate(
	mode: LaunchMode,
	probe: WorkerProbe,
): Result<string, WorkerError> {
	for (const binary of mode.binaries) {
		const path = probe.which(binary);
		if (path !== null) return { ok: true, value: path };
	}
	return {
		ok: false,
		error: {
			code: "not_installed",
			message: `${mode.binaries.join(" / ")} is not on PATH`,
			hint: mode.install,
		},
	};
}

function resolveAcp(
	definition: WorkerDefinition,
	probe: WorkerProbe,
): Result<WorkerSpec, WorkerError> {
	const { acp, name } = definition;
	const found = locate(acp, probe);
	if (!found.ok) return found;
	const version = parseVersion(probe.version(found.value));
	const min = MIN_ADAPTER_VERSIONS[name];
	// An unreadable version is let through: the ACP handshake still refuses
	// a protocol the harness does not speak.
	if (min !== null && version !== undefined) {
		if (compareVersions(version, min) < 0) {
			return {
				ok: false,
				error: {
					code: "outdated",
					message: `${definition.adapterPackage} ${version} is older than the minimum ${min} for ${name}`,
					hint: acp.install,
				},
			};
		}
	}
	return {
		ok: true,
		value: {
			name,
			launch: { name, command: found.value, args: [...acp.args] },
			protocol: "acp",
			enforcement: "gate",
			taskVia: "acp",
			capabilities: { permissionRequests: true, toolCallReports: true },
			innerSandbox: acp.innerSandbox,
			...(version === undefined ? {} : { version }),
		},
	};
}

function resolveHeadless(
	definition: WorkerDefinition,
	probe: WorkerProbe,
): Result<WorkerSpec, WorkerError> {
	const found = locate(definition.headless, probe);
	if (!found.ok) return found;
	return { ok: true, value: headlessSpec(definition, found.value) };
}

/**
 * Resolves `claude` | `codex` | `cursor` | `gemini` | `opencode` to its ACP
 * worker, or `headless:<name>` to that agent's sandbox-only fallback.
 */
export function resolveWorker(
	name: string,
	probe: WorkerProbe = systemProbe,
): Result<WorkerSpec, WorkerError> {
	const headless = name.startsWith(HEADLESS_PREFIX);
	const agent = headless ? name.slice(HEADLESS_PREFIX.length) : name;
	if (!isWorkerName(agent)) {
		return {
			ok: false,
			error: {
				code: "unknown_worker",
				message: `unknown worker "${name}"; supported: ${WORKER_NAMES.join(", ")} (or headless:<name>)`,
			},
		};
	}
	const definition = DEFINITIONS[agent];
	return headless
		? resolveHeadless(definition, probe)
		: resolveAcp(definition, probe);
}

/**
 * Every worker that would resolve on this machine: the ACP workers first,
 * then the headless fallbacks, each in `WORKER_NAMES` order.
 */
export function detectInstalled(
	probe: WorkerProbe = systemProbe,
): WorkerSpec[] {
	const acp = WORKER_NAMES.map((name) => resolveAcp(DEFINITIONS[name], probe));
	const headless = WORKER_NAMES.map((name) =>
		resolveHeadless(DEFINITIONS[name], probe),
	);
	return [...acp, ...headless].flatMap((result) =>
		result.ok ? [result.value] : [],
	);
}
