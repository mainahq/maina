/**
 * Constitution gate (FR-SPEC-2): the plan's `## Constitution gate` checklist
 * graded before any code is written.
 *
 * Every checklist item is a rule; an unchecked rule is a violation. A tick
 * counts only when it records a decide id or a human (`<!-- ticked-by: … -->`,
 * FR-SPEC-6): the writing agent cannot tick its own gate, so an unattested
 * tick is a violation too. A rule is MUST unless its text says SHOULD. A
 * MUST violation blocks the plan unless the plan's justification table
 * (`### Justifications` or `## Complexity tracking`) has a row naming the
 * rule with a reason. SHOULD violations are recorded and never block. A plan
 * with no gate section, or a gate with no rules, blocks. Pure: plan text in,
 * report out.
 */

import { isAttestedTick } from "./checklist";

export type RuleLevel = "must" | "should";

export type GateRule = Readonly<{
	name: string;
	level: RuleLevel;
	checked: boolean;
	/** The tick records a decide or human source; false when unchecked. */
	attested: boolean;
	/** 1-based line of the checklist item in the plan. */
	line: number;
}>;

export type GateViolation = Readonly<{
	rule: string;
	level: RuleLevel;
	/**
	 * 1-based line of the rule; the gate heading's line when the gate has no
	 * rules; 0 when the gate section itself is missing.
	 */
	line: number;
	/** The recorded reason, when the justification table names the rule. */
	justification: string | undefined;
	blocking: boolean;
}>;

export type ConstitutionGateReport = Readonly<{
	/** No blocking violation. */
	passed: boolean;
	rules: readonly GateRule[];
	violations: readonly GateViolation[];
}>;

const GATE_HEADING = /^##\s+constitution\s+gate\b/i;
const JUSTIFICATION_HEADING =
	/^#{2,3}\s+(justifications?|complexity\s+tracking)\b/i;
const CHECK_ITEM = /^\s*-\s+\[([ xX])\]\s+(.*)$/;

function isHeading(line: string): boolean {
	return /^#{1,2}\s/.test(line);
}

/** Bold (`**Name**`) label of an item, else its text up to a dash. */
function ruleName(text: string): string {
	const bold = text.match(/^\*\*(.+?)\*\*/);
	if (bold?.[1]) return bold[1].trim();
	return (text.split(/\s+[—–-]\s+/)[0] ?? text).trim();
}

function normalise(name: string): string {
	return name.replace(/[*`]/g, "").trim().toLowerCase();
}

function parseRules(lines: readonly string[], start: number): GateRule[] {
	const rules: GateRule[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (isHeading(line)) break;
		const item = line.match(CHECK_ITEM);
		if (!item?.[2]) continue;
		const checked = item[1] !== " ";
		rules.push({
			name: ruleName(item[2]),
			level: /\bSHOULD\b/.test(item[2]) ? "should" : "must",
			checked,
			attested: checked && isAttestedTick(item[2]),
			line: i + 1,
		});
	}
	return rules;
}

/** A cell still holding template placeholder text (`[Why …]`). */
function isPlaceholder(cell: string): boolean {
	return /^\[.*\]$/.test(cell);
}

/** Normalised rule name → recorded reason, from every justification table. */
function parseJustifications(lines: readonly string[]): Map<string, string> {
	const reasons = new Map<string, string>();
	let inTable = false;
	for (const line of lines) {
		if (JUSTIFICATION_HEADING.test(line)) {
			inTable = true;
			continue;
		}
		if (inTable && isHeading(line)) inTable = false;
		if (!inTable || !line.trim().startsWith("|")) continue;
		const cells = line
			.trim()
			.replace(/^\||\|$/g, "")
			.split("|")
			.map((c) => c.trim());
		const [rule = "", reason = ""] = cells;
		if (/^:?-+:?$/.test(rule) || normalise(rule) === "rule") continue;
		if (reason.length === 0 || isPlaceholder(reason) || isPlaceholder(rule)) {
			continue;
		}
		reasons.set(normalise(rule), reason);
	}
	return reasons;
}

/** The blocking violation for a gate that is missing (or checks nothing). */
function missingGate(): GateViolation {
	return {
		rule: "Constitution gate",
		level: "must",
		line: 0,
		justification: undefined,
		blocking: true,
	};
}

/** Grades a plan's constitution gate. */
export function constitutionGate(plan: string): ConstitutionGateReport {
	const lines = plan.split("\n");
	const start = lines.findIndex((l) => GATE_HEADING.test(l.trim()));
	if (start === -1) {
		return { passed: false, rules: [], violations: [missingGate()] };
	}
	const rules = parseRules(lines, start);
	if (rules.length === 0) {
		// An empty gate checks nothing, so it cannot pass.
		return {
			passed: false,
			rules,
			violations: [{ ...missingGate(), line: start + 1 }],
		};
	}
	const reasons = parseJustifications(lines);
	const violations = rules
		.filter((r) => !r.checked || !r.attested)
		.map((r): GateViolation => {
			const justification = reasons.get(normalise(r.name));
			return {
				rule: r.name,
				level: r.level,
				line: r.line,
				justification,
				blocking: r.level === "must" && justification === undefined,
			};
		});
	return {
		passed: violations.every((v) => !v.blocking),
		rules,
		violations,
	};
}
