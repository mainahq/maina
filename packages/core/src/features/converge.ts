/**
 * Spec convergence (FR-SPEC-5): does the delivered work match the spec?
 *
 * Compares a feature's requirements (`**FR-###**` / `**SC-###**` in spec.md)
 * with its tasks (tasks.md checklist items and the ids they cite) and
 * reports every gap as one of four types:
 *
 * - `missing`: a requirement no task cites.
 * - `partial`: a requirement cited by tasks that are not all ticked by a
 *   decide id or a human (an unattested tick does not count).
 * - `contradicts`: a task doing what the spec's Out of scope list rules out.
 * - `unrequested`: a task citing a requirement the spec does not define, or
 *   citing none while its text maps to nothing in the spec.
 *
 * `convergeCheck` turns the report into a receipt check, so the gaps are
 * recorded on the receipt.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../db/index";
import {
	type DecidePorts,
	defaultDecidePorts,
	judgeEach,
} from "../decide/decide";
import type { Check, Finding } from "../receipt/types";
import { STOP_WORDS } from "../utils";
import { isAttestedTick } from "./checklist";

export const GAP_TYPES = [
	"missing",
	"partial",
	"contradicts",
	"unrequested",
] as const;

export type GapType = (typeof GAP_TYPES)[number];

export type ConvergeGap = Readonly<{
	type: GapType;
	/** The requirement (`FR-001`) or task (`T-003`) the gap is about. */
	subject: string;
	message: string;
	file: "spec.md" | "tasks.md";
	/** 1-based line in `file`. */
	line: number;
}>;

export type ConvergeReport = Readonly<{
	/** Requirements the spec defines. */
	requirements: number;
	/** Gaps ordered by `GAP_TYPES`, then by line. */
	gaps: readonly ConvergeGap[];
	converged: boolean;
}>;

export type FeatureConvergeReport = ConvergeReport &
	Readonly<{ feature: string }>;

type Requirement = Readonly<{ id: string; line: number }>;

type Task = Readonly<{
	id: string;
	text: string;
	done: boolean;
	cites: readonly string[];
	line: number;
}>;

const REQUIREMENT = /\*\*((?:FR|SC)-\d+)\*\*/;
const CITATION = /\b(?:FR|SC)-\d+\b/g;
const TASK = /^\s*-\s+\[([ xX])\]\s+(?:\*\*(T-?\d+)\*\*|(T-?\d+):)\s*(.*)$/;

function parseRequirements(spec: string): Requirement[] {
	const seen = new Set<string>();
	const requirements: Requirement[] = [];
	for (const [i, line] of spec.split("\n").entries()) {
		if (line.trimStart().startsWith(">")) continue;
		const id = line.match(REQUIREMENT)?.[1];
		if (id === undefined || seen.has(id)) continue;
		seen.add(id);
		requirements.push({ id, line: i + 1 });
	}
	return requirements;
}

/** Bullet items of the spec's `## Out of scope` section. */
function parseOutOfScope(spec: string): string[] {
	const items: string[] = [];
	let inSection = false;
	for (const line of spec.split("\n")) {
		if (/^##\s/.test(line)) {
			inSection = /^##\s+out\s+of\s+scope/i.test(line);
			continue;
		}
		const item = inSection ? line.match(/^\s*[-*]\s+(.+)$/)?.[1] : undefined;
		if (item !== undefined) items.push(item.trim());
	}
	return items;
}

function parseTasks(tasks: string): Task[] {
	const parsed: Task[] = [];
	for (const [i, line] of tasks.split("\n").entries()) {
		const match = line.match(TASK);
		const id = match?.[2] ?? match?.[3];
		if (!match || id === undefined) continue;
		const raw = match[4] ?? "";
		const text = raw.replace(/<!--.*?-->/g, "").trim();
		parsed.push({
			id,
			text,
			// Only a decide or human tick delivers a task (FR-SPEC-6).
			done: match[1] !== " " && isAttestedTick(raw),
			cites: [...new Set(text.match(CITATION) ?? [])],
			line: i + 1,
		});
	}
	return parsed;
}

function keywords(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function requirementGaps(
	requirements: readonly Requirement[],
	tasks: readonly Task[],
): ConvergeGap[] {
	return requirements.flatMap((req): ConvergeGap[] => {
		const citing = tasks.filter((t) => t.cites.includes(req.id));
		if (citing.length === 0) {
			return [
				{
					type: "missing",
					subject: req.id,
					message: `${req.id} has no task delivering it`,
					file: "spec.md",
					line: req.line,
				},
			];
		}
		const done = citing.filter((t) => t.done).length;
		if (done === citing.length) return [];
		return [
			{
				type: "partial",
				subject: req.id,
				message: `${req.id} is partly delivered: ${done} of ${citing.length} tasks done`,
				file: "spec.md",
				line: req.line,
			},
		];
	});
}

/** Tasks the Out of scope list rules out (`spec.coverage` of each item). */
function contradictingTasks(
	ports: DecidePorts,
	outOfScope: readonly string[],
	tasks: readonly Task[],
): ReadonlySet<Task> {
	const pairs = tasks.flatMap((task) => {
		const text = task.text.toLowerCase();
		return outOfScope.flatMap((item) => {
			const words = keywords(item);
			if (words.length === 0) return [];
			const matched = words.filter((w) => text.includes(w)).length;
			return [{ task, item, matched, total: words.length }];
		});
	});
	const covered = judgeEach(ports, {
		type: "spec.coverage",
		check: "criterion",
		trusted: pairs.map(({ matched, total }) => ({ matched, total })),
		untrusted: pairs.map(({ item }) => ({ text: item })),
	});
	return new Set(pairs.filter((_, i) => covered[i]?.answer).map((p) => p.task));
}

/** Uncited tasks whose text maps to nothing in the spec (`spec.orphan`). */
function orphanTasks(
	ports: DecidePorts,
	spec: string,
	tasks: readonly Task[],
): ReadonlySet<Task> {
	const specWords = new Set(keywords(spec));
	const candidates = tasks
		.map((task) => ({ task, words: keywords(task.text) }))
		.filter(({ words }) => words.length > 0);
	const orphaned = judgeEach(ports, {
		type: "spec.orphan",
		check: "task",
		trusted: candidates.map(({ words }) => ({
			hasSpecRef: false,
			matched: words.filter((w) => specWords.has(w)).length,
			total: words.length,
		})),
		untrusted: candidates.map(({ task }) => ({ text: task.text })),
	});
	return new Set(
		candidates.filter((_, i) => orphaned[i]?.answer).map((c) => c.task),
	);
}

function taskGaps(
	ports: DecidePorts,
	spec: string,
	requirements: readonly Requirement[],
	tasks: readonly Task[],
): ConvergeGap[] {
	const defined = new Set(requirements.map((r) => r.id));
	const contradicting = contradictingTasks(ports, parseOutOfScope(spec), tasks);
	const uncited = tasks.filter(
		(t) => t.cites.length === 0 && !contradicting.has(t),
	);
	const orphaned = orphanTasks(ports, spec, uncited);
	return tasks.flatMap((task): ConvergeGap[] => {
		const at = { subject: task.id, file: "tasks.md" as const, line: task.line };
		if (contradicting.has(task)) {
			return [
				{
					type: "contradicts",
					message: `${task.id} does what the spec rules out of scope`,
					...at,
				},
			];
		}
		const unknown = task.cites.filter((id) => !defined.has(id));
		if (unknown.length > 0) {
			return [
				{
					type: "unrequested",
					message: `${task.id} cites ${unknown.join(", ")}, which the spec does not define`,
					...at,
				},
			];
		}
		if (orphaned.has(task)) {
			return [
				{
					type: "unrequested",
					message: `${task.id} maps to no requirement in the spec`,
					...at,
				},
			];
		}
		return [];
	});
}

/** Compares spec text with tasks text. */
export function convergeArtifacts(
	spec: string,
	tasks: string,
	ports: DecidePorts = defaultDecidePorts,
): ConvergeReport {
	const requirements = parseRequirements(spec);
	const parsedTasks = parseTasks(tasks);
	const rank = (g: ConvergeGap) => GAP_TYPES.indexOf(g.type);
	const gaps = [
		...requirementGaps(requirements, parsedTasks),
		...taskGaps(ports, spec, requirements, parsedTasks),
	].sort((a, b) => rank(a) - rank(b) || a.line - b.line);
	return {
		requirements: requirements.length,
		gaps,
		converged: gaps.length === 0,
	};
}

export type ConvergeError = Readonly<{
	kind: "invalid_feature" | "missing_spec";
	message: string;
}>;

const FEATURE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function readText(path: string): string | undefined {
	if (!existsSync(path)) return undefined;
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return undefined;
	}
}

/**
 * Converges `<root>/.maina/features/<feature>/`: spec.md is required, a
 * missing tasks.md leaves every requirement missing.
 */
export function converge(
	root: string,
	feature: string,
	ports: DecidePorts = defaultDecidePorts,
): Result<FeatureConvergeReport, ConvergeError> {
	if (!FEATURE_NAME.test(feature) || feature.includes("..")) {
		return {
			ok: false,
			error: {
				kind: "invalid_feature",
				message: `Invalid feature name: ${feature}`,
			},
		};
	}
	const dir = join(root, ".maina", "features", feature);
	const spec = readText(join(dir, "spec.md"));
	if (spec === undefined) {
		return {
			ok: false,
			error: { kind: "missing_spec", message: `spec.md not found in ${dir}` },
		};
	}
	const tasks = readText(join(dir, "tasks.md")) ?? "";
	return {
		ok: true,
		value: { feature, ...convergeArtifacts(spec, tasks, ports) },
	};
}

const GAP_SEVERITY: Readonly<Record<GapType, Finding["severity"]>> = {
	missing: "error",
	partial: "warning",
	contradicts: "error",
	unrequested: "warning",
};

/**
 * The receipt check recording a convergence report: one finding per gap,
 * ruled `converge/<type>`; failed when a gap is an error.
 */
export function convergeCheck(report: FeatureConvergeReport): Check {
	const findings: Finding[] = report.gaps.map((gap) => ({
		severity: GAP_SEVERITY[gap.type],
		file: `.maina/features/${report.feature}/${gap.file}`,
		line: gap.line,
		message: gap.message,
		rule: `converge/${gap.type}`,
	}));
	return {
		id: "converge-check",
		name: "Spec convergence",
		status: findings.some((f) => f.severity === "error") ? "failed" : "passed",
		tool: "review-spec",
		findings,
	};
}
