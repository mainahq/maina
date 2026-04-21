/**
 * Scan orchestrator.
 *
 * Runs the three deterministic scanners (lint-config, tree-sitter sampler,
 * git-log) in parallel and returns the flattened `Rule[]`. Never throws —
 * individual scanner failures are surfaced as warnings but do not abort the
 * orchestrator.
 */

import type { Result } from "../../db/index";
import type { Rule } from "../adopt";
import { scanGitLog } from "./git-log";
import { scanLintConfig } from "./lint-config";
import { scanTreeSitter } from "./tree-sitter";

export interface ScanReport {
	rules: Rule[];
	warnings: string[];
}

export async function scanRepo(
	cwd: string,
): Promise<Result<ScanReport, string>> {
	const [lintRes, astRes, gitRes] = await Promise.all([
		scanLintConfig(cwd),
		scanTreeSitter(cwd),
		scanGitLog(cwd),
	]);

	const rules: Rule[] = [];
	const warnings: string[] = [];

	if (lintRes.ok) rules.push(...lintRes.value);
	else warnings.push(`scan/lint-config: ${lintRes.error}`);

	if (astRes.ok) rules.push(...astRes.value);
	else warnings.push(`scan/tree-sitter: ${astRes.error}`);

	if (gitRes.ok) rules.push(...gitRes.value);
	else warnings.push(`scan/git-log: ${gitRes.error}`);

	return { ok: true, value: { rules, warnings } };
}

export { scanGitLog } from "./git-log";
export { scanLintConfig } from "./lint-config";
export { scanTreeSitter } from "./tree-sitter";
