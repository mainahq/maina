/**
 * `maina allow <decision-id> [--always]` (FR-GATE-8, FR-DEC-4): the override
 * path for a gate message. It records an `override` outcome on the logged
 * decision; `--always` also remembers the action as a scoped allow rule in
 * the user policy (`~/.maina/policy.json`). It never writes a repo policy.
 * Thin wrapper over core's `recordOverride` and `rememberOverride`.
 */

import { join } from "node:path";
import {
	type ClockPort,
	type DbPort,
	type FsPort,
	findGateSubject,
	type OverrideError,
	type RulePolicy,
	recordOverride,
	rememberOverride,
	scopedAllowRules,
} from "@mainahq/core";
import { Command } from "commander";
import { openDecisionDb } from "../decision-store";
import { processEnv } from "../env";
import { EXIT_CONFIG_ERROR } from "../json";
import { nodeFs } from "../ports";

interface AllowActionOptions {
	decisionId: string;
	always: boolean;
	json?: boolean;
}

interface AllowDeps {
	db: DbPort;
	fs: FsPort;
	/** The user's home directory; `--always` needs it. */
	home: string | undefined;
	clock: ClockPort;
	print: (text: string) => void;
}

type AllowError =
	| OverrideError
	| Readonly<{ kind: "no_home" }>
	| Readonly<{ kind: "store"; message: string }>;

type Remembered = Readonly<{
	file: string;
	added: number;
	rules: readonly RulePolicy[];
}>;

type AllowValue = Readonly<{ decisionId: string; remembered?: Remembered }>;

type AllowResult =
	| Readonly<{ ok: true; value: AllowValue }>
	| Readonly<{ ok: false; error: AllowError }>;

/** One line saying why the override failed. */
function describeAllowError(id: string, error: AllowError): string {
	switch (error.kind) {
		case "outcome":
			return error.error.kind === "unknown_decision"
				? `no logged gate decision ${id}`
				: `could not record the override (${error.error.kind})`;
		case "unknown_subject":
			return `no gate subject recorded for ${id}, so --always has nothing to scope a rule to`;
		case "not_scopable":
			return `--always cannot remember ${id}: ${error.reason}; run without --always to record a one-time override`;
		case "policy":
			return `the user policy is invalid, so it was not changed: ${error.errors.map((e) => `${e.path || e.file || "policy"}: ${e.message}`).join("; ")}`;
		case "fs":
			return `could not write ${error.path}: ${error.message}`;
		case "db":
		case "store":
			return `the decision store failed: ${error.message}`;
		case "corrupt_row":
			return `the gate subject for ${id} is corrupt`;
		case "no_home":
			return "no home directory (HOME is unset), so --always has no user policy to write";
		default: {
			const unreachable: never = error;
			return unreachable;
		}
	}
}

function fail(error: AllowError): Readonly<{ ok: false; error: AllowError }> {
	return { ok: false, error };
}

type Plan = Readonly<{ home: string; rules: readonly RulePolicy[] }>;

/**
 * What `--always` would write, worked out before anything is recorded so a
 * refused `--always` leaves no half-done override. `undefined` without it.
 */
function planAlways(
	options: AllowActionOptions,
	deps: AllowDeps,
): Readonly<{ ok: true; value: Plan | undefined }> | ReturnType<typeof fail> {
	if (!options.always) return { ok: true, value: undefined };
	if (deps.home === undefined) return fail({ kind: "no_home" });
	const subject = findGateSubject(deps.db, options.decisionId);
	if (!subject.ok) return fail(subject.error);
	if (subject.value === undefined) {
		return fail({ kind: "unknown_subject", decisionId: options.decisionId });
	}
	const rules = scopedAllowRules(subject.value);
	return rules.ok
		? { ok: true, value: { home: deps.home, rules: rules.value } }
		: fail(rules.error);
}

async function run(
	options: AllowActionOptions,
	deps: AllowDeps,
): Promise<AllowResult> {
	const plan = planAlways(options, deps);
	if (!plan.ok) return plan;

	const recorded = recordOverride(
		{ db: deps.db, clock: deps.clock },
		options.decisionId,
	);
	if (!recorded.ok) return fail(recorded.error);
	if (plan.value === undefined) {
		return { ok: true, value: { decisionId: options.decisionId } };
	}

	const { home, rules } = plan.value;
	const remembered = await rememberOverride({ fs: deps.fs }, home, rules);
	if (!remembered.ok) return fail(remembered.error);
	return {
		ok: true,
		value: {
			decisionId: options.decisionId,
			remembered: { ...remembered.value, rules },
		},
	};
}

function summary(value: AllowValue): string {
	const base = `maina allow: override recorded for ${value.decisionId}`;
	const { remembered } = value;
	if (remembered === undefined) return base;
	const matches = remembered.rules
		.map((r) => `${r.kind} ${JSON.stringify(r.match)}`)
		.join(", ");
	return remembered.added === 0
		? `${base}; ${matches} was already allowed in ${remembered.file}`
		: `${base}; always allowed in ${remembered.file}: ${matches}`;
}

/** Records the override for `options.decisionId` and prints one line. */
export async function allowAction(
	options: AllowActionOptions,
	deps: AllowDeps,
): Promise<AllowResult> {
	const result = await run(options, deps);
	if (options.json) {
		const meta = { command: "allow" };
		deps.print(
			JSON.stringify(
				result.ok
					? { data: result.value, error: null, meta }
					: { data: null, error: result.error, meta },
				null,
				2,
			),
		);
	} else {
		deps.print(
			result.ok
				? summary(result.value)
				: `maina allow: ${describeAllowError(options.decisionId, result.error)}`,
		);
	}
	return result;
}

export function allowCommand(): Command {
	return new Command("allow")
		.description(
			"Override a gate decision; --always also allows the action in your user policy",
		)
		.argument("<decision-id>", "The id from the gate message")
		.option(
			"--always",
			"Remember it: add a scoped allow rule to ~/.maina/policy.json (never the repo policy)",
		)
		.option("--json", "Print the result as JSON")
		.action(
			async (
				decisionId: string,
				opts: { always?: boolean; json?: boolean },
			) => {
				const cwd = process.cwd();
				const print = (text: string) => process.stdout.write(`${text}\n`);
				const store = openDecisionDb(join(cwd, ".maina"));
				if (!store.ok) {
					print(
						`maina allow: ${describeAllowError(decisionId, { kind: "store", message: store.error })}`,
					);
					process.exitCode = EXIT_CONFIG_ERROR;
					return;
				}
				try {
					const home = processEnv.get("HOME") || processEnv.get("USERPROFILE");
					const result = await allowAction(
						{
							decisionId,
							always: opts.always === true,
							json: opts.json === true,
						},
						{
							db: store.value.db,
							fs: nodeFs,
							home: home || undefined,
							clock: { now: () => Date.now() },
							print,
						},
					);
					if (!result.ok) process.exitCode = EXIT_CONFIG_ERROR;
				} finally {
					store.value.close();
				}
			},
		);
}
