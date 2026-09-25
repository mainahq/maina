/**
 * Recorded overrides (FR-GATE-8, FR-DEC-4).
 *
 * - `recordOverride` links an `override` outcome to the logged gate decision
 *   the user overrode, so the decision's error rate can learn from it.
 * - `gateSubject` / `recordGateSubject` keep, per decision, what the action
 *   was, and `findGateSubject` reads it back for `maina allow`.
 * - `scopedAllowRules` turns a subject into allow rules, one per command
 *   (or the path, tool or URL), scoped to the event kind, and refuses what
 *   an allow rule cannot or should not cover: an irreversible class, a final
 *   deny, an opaque command, a wildcard. Every rule is `exact`: it matches
 *   the remembered command, path, tool or URL and nothing else, so
 *   `bun test` does not cover `bun test --watch`. A wider rule is a pattern
 *   the user writes into the policy by hand.
 * - `rememberOverride` merges those rules into the user policy
 *   (`~/.maina/policy.json`). It never touches a repo policy: a remembered
 *   override is this user's choice, not the repository's.
 */

import type { Result } from "../db/index";
import { linkOutcome } from "../decide/outcomes/link";
import type {
	OutcomeError,
	OutcomePorts,
	OutcomeRecord,
} from "../decide/outcomes/types";
import { DEFAULT_POLICY } from "../policy/defaults";
import { readUserPolicy, userPolicyFile } from "../policy/load";
import {
	GATE_EVENT_KINDS,
	type Policy,
	type PolicyError,
	type PolicyLayer,
	parsePolicyLayer,
	type RulePolicy,
	ruleKey,
} from "../policy/schema";
import type { DbPort, DbRow } from "../ports/db";
import type { FsError, FsPort } from "../ports/fs";
import { analyzeAction } from "./classify";
import { withPolicyBranches } from "./evaluate";
import type { GateContext, GateEvent, GateEventKind } from "./events";
import { evaluateRules, type RuleResult } from "./rules";

/** What one gate decision was about, as a scoped rule needs it. */
export type GateSubject = Readonly<{
	decisionId: string;
	kind: GateEventKind;
	/** The exact strings a scoped rule matches: commands, a path, a tool, a URL. */
	targets: readonly string[];
	classes: readonly string[];
	/** What the rules engine said, before any model. */
	rule: RuleResult["kind"];
	irreversible: boolean;
}>;

export type OverrideError =
	| Readonly<{ kind: "outcome"; error: OutcomeError }>
	| Readonly<{ kind: "unknown_subject"; decisionId: string }>
	| Readonly<{ kind: "not_scopable"; decisionId: string; reason: string }>
	| Readonly<{ kind: "policy"; errors: readonly PolicyError[] }>
	| Readonly<{ kind: "fs"; path: string; message: string }>
	| Readonly<{ kind: "db"; message: string }>
	| Readonly<{ kind: "corrupt_row"; decisionId: string }>;

/** The observer label on override outcomes. */
const SOURCE = "gate";

// ── Outcome ─────────────────────────────────────────────────────────────────

/** Links an `override` outcome to `decisionId`. Idempotent. */
export function recordOverride(
	ports: OutcomePorts,
	decisionId: string,
): Result<OutcomeRecord, OverrideError> {
	const linked = linkOutcome(ports, decisionId, {
		kind: "override",
		source: SOURCE,
	});
	return linked.ok
		? { ok: true, value: linked.value.record }
		: { ok: false, error: { kind: "outcome", error: linked.error } };
}

// ── Subjects ────────────────────────────────────────────────────────────────

function isIrreversible(id: string, policy: Policy): boolean {
	return (
		DEFAULT_POLICY.action_classes[id]?.irreversible === true ||
		policy.action_classes[id]?.irreversible === true
	);
}

/** The exact strings a rule for `event` would match. */
function targetsOf(event: GateEvent, commands: readonly string[]): string[] {
	switch (event.kind) {
		case "shell":
			return [...commands];
		case "file.write":
		case "file.read.outside":
			return [event.action.path];
		case "mcp":
			return [`${event.action.server}/${event.action.tool}`];
		case "network":
			return [event.action.url];
		default: {
			const unreachable: never = event;
			return unreachable;
		}
	}
}

/** The subject of gate decision `decisionId` for `event` under `policy`. */
export function gateSubject(
	decisionId: string,
	event: GateEvent,
	policy: Policy,
	ctx: GateContext,
): GateSubject {
	// Classified as the gate saw it: the policy's protected branches count.
	const seen = withPolicyBranches(ctx, policy);
	const analysis = analyzeAction(event, seen);
	const rules = evaluateRules(event, policy, seen);
	return {
		decisionId,
		kind: event.kind,
		targets: targetsOf(event, analysis.commands),
		classes: analysis.classes,
		rule: rules.kind,
		irreversible: analysis.classes.some((c) => isIrreversible(c, policy)),
	};
}

/** Stores `subject`. Recording the same decision again keeps the first row. */
export function recordGateSubject(
	db: DbPort,
	subject: GateSubject,
): Result<void, OverrideError> {
	const inserted = db.run(
		`INSERT OR IGNORE INTO gate_subject
			(decision_id, kind, targets, classes, rule, irreversible)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		[
			subject.decisionId,
			subject.kind,
			JSON.stringify(subject.targets),
			JSON.stringify(subject.classes),
			subject.rule,
			subject.irreversible ? 1 : 0,
		],
	);
	return inserted.ok
		? { ok: true, value: undefined }
		: { ok: false, error: { kind: "db", message: inserted.error.message } };
}

const RULE_KINDS: readonly RuleResult["kind"][] = [
	"deny",
	"allow",
	"ask",
	"no_rule",
];

function stringList(json: unknown): readonly string[] | undefined {
	if (typeof json !== "string") return undefined;
	try {
		const value: unknown = JSON.parse(json);
		return Array.isArray(value) && value.every((v) => typeof v === "string")
			? value
			: undefined;
	} catch {
		return undefined;
	}
}

function toSubject(row: DbRow): GateSubject | undefined {
	const kind = GATE_EVENT_KINDS.find((k) => k === row.kind);
	const rule = RULE_KINDS.find((r) => r === row.rule);
	const targets = stringList(row.targets);
	const classes = stringList(row.classes);
	if (
		typeof row.decision_id !== "string" ||
		kind === undefined ||
		rule === undefined ||
		targets === undefined ||
		classes === undefined
	) {
		return undefined;
	}
	return {
		decisionId: row.decision_id,
		kind,
		targets,
		classes,
		rule,
		irreversible: row.irreversible === 1,
	};
}

/** The subject recorded for `decisionId`, or `undefined` when there is none. */
export function findGateSubject(
	db: DbPort,
	decisionId: string,
): Result<GateSubject | undefined, OverrideError> {
	const rows = db.all("SELECT * FROM gate_subject WHERE decision_id = ?", [
		decisionId,
	]);
	if (!rows.ok) {
		return { ok: false, error: { kind: "db", message: rows.error.message } };
	}
	const [row] = rows.value;
	if (row === undefined) return { ok: true, value: undefined };
	const subject = toSubject(row);
	return subject === undefined
		? { ok: false, error: { kind: "corrupt_row", decisionId } }
		: { ok: true, value: subject };
}

// ── Scoped rules ────────────────────────────────────────────────────────────

/** Why `subject` cannot be remembered as an allow rule, if it cannot. */
function unscopable(subject: GateSubject): string | undefined {
	if (subject.irreversible) {
		return "the action is irreversible, so it always asks and no allow rule reaches it";
	}
	if (subject.rule === "deny") {
		return "a deny rule or class is final, so an allow rule would change nothing";
	}
	if (subject.classes.includes("shell.opaque")) {
		return "the command is opaque to the gate, so no rule can name it exactly";
	}
	if (subject.targets.length === 0) return "the action has nothing to match";
	if (subject.targets.some((t) => t.includes("*") || t.trim() === "")) {
		return "a target contains a wildcard, so a rule for it would match more than this action";
	}
	return undefined;
}

/**
 * Allow rules for `subject`, one per target, scoped to its kind and marked
 * `exact`, so a shell rule matches that command only, never the same
 * command with extra arguments.
 */
export function scopedAllowRules(
	subject: GateSubject,
): Result<readonly RulePolicy[], OverrideError> {
	const reason = unscopable(subject);
	if (reason !== undefined) {
		return {
			ok: false,
			error: { kind: "not_scopable", decisionId: subject.decisionId, reason },
		};
	}
	return {
		ok: true,
		value: subject.targets.map((match) => ({
			match,
			kind: subject.kind,
			exact: true,
			reason: `allowed with maina allow ${subject.decisionId} --always`,
		})),
	};
}

// ── User policy ─────────────────────────────────────────────────────────────

/**
 * `raw` (the user policy file's JSON, `undefined` when there is none) with
 * `rules` appended to `rules.allow`, each once. Every other key is kept. An
 * invalid layer is an error: it is never overwritten.
 */
export function withUserRules(
	raw: unknown,
	rules: readonly RulePolicy[],
): Result<Readonly<{ layer: PolicyLayer; added: number }>, OverrideError> {
	// Only a missing file starts an empty layer; a file holding `null` is
	// invalid like any other non-object, so it is reported, not overwritten.
	const parsed = parsePolicyLayer(raw === undefined ? {} : raw, "user");
	if (!parsed.ok) {
		return { ok: false, error: { kind: "policy", errors: parsed.error } };
	}
	const layer = parsed.value;
	const allow = layer.rules?.allow ?? [];
	const seen = new Set(allow.map(ruleKey));
	const added = rules.filter((rule) => {
		if (seen.has(ruleKey(rule))) return false;
		seen.add(ruleKey(rule));
		return true;
	});
	if (added.length === 0) return { ok: true, value: { layer, added: 0 } };
	return {
		ok: true,
		value: {
			layer: {
				...layer,
				rules: { ...layer.rules, allow: [...allow, ...added] },
			},
			added: added.length,
		},
	};
}

/**
 * Merges `rules` into the user policy under `home`. The first write backs up
 * an existing file to `policy.json.bak`. Returns the file written and how
 * many rules were new.
 */
export async function rememberOverride(
	ports: Readonly<{ fs: FsPort }>,
	home: string,
	rules: readonly RulePolicy[],
): Promise<Result<Readonly<{ file: string; added: number }>, OverrideError>> {
	const file = userPolicyFile(home);
	const raw = await readUserPolicy(ports, home);
	if (!raw.ok)
		return { ok: false, error: { kind: "policy", errors: raw.error } };
	const merged = withUserRules(raw.value, rules);
	if (!merged.ok) return merged;
	if (merged.value.added === 0) return { ok: true, value: { file, added: 0 } };

	const backup = `${file}.bak`;
	if (raw.value !== undefined && !(await ports.fs.exists(backup))) {
		const original = await ports.fs.readFile(file);
		if (!original.ok) return fsError(file, original.error);
		const saved = await ports.fs.writeFile(backup, original.value);
		if (!saved.ok) return fsError(backup, saved.error);
	}
	const written = await ports.fs.writeFile(
		file,
		`${JSON.stringify(merged.value.layer, null, 2)}\n`,
	);
	if (!written.ok) return fsError(file, written.error);
	return { ok: true, value: { file, added: merged.value.added } };
}

function fsError(path: string, error: FsError): Result<never, OverrideError> {
	const message = error.kind === "io" ? error.message : "not found";
	return { ok: false, error: { kind: "fs", path, message } };
}
