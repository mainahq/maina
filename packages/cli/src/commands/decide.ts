/**
 * `maina decide --type <t> [--json]` (FR-SPEC-7): answers one decision
 * through core's `decide`, with the policy the gate uses (defaults < user
 * `~/.maina/policy.json` < repo `.maina/policy.json`), so a workflow that is
 * not an agent host, such as a Spec Kit workflow `shell` step, can route on
 * a Maina verdict.
 *
 * The request state comes from `--input` (a JSON file, or `-` for stdin:
 * `{ state?: { trusted?, untrusted? }, questions? }`) and from repeatable
 * `--trusted key=value` / `--untrusted key=value` flags, which override it.
 * A type with fixed options (`action.risk`: allow | ask | deny) gets one
 * default choice question; any other type needs `questions` in the input.
 *
 * Exit codes: 0 whenever a verdict was reached, whatever it is (the verdict
 * is data: route on it), 3 for bad input, an unknown type or an invalid
 * policy, 2 when the backend could not answer. A failure prints no verdict,
 * so a workflow that reads one fails closed.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import {
	type ClockPort,
	DECISION_CATALOG,
	DEFAULT_REGISTRY,
	type DecideError,
	type Decision,
	type DecisionType,
	decide,
	type FsPort,
	getRepoRoot,
	loadPolicy,
	type PolicyError,
	type Question,
	readUserPolicy,
} from "@mainahq/core";
import { Command } from "commander";
import { processEnv } from "../env";
import { EXIT_CONFIG_ERROR, EXIT_PASSED, EXIT_TOOL_FAILURE } from "../json";
import { nodeFs } from "../ports";

// ── Types ───────────────────────────────────────────────────────────────────

type DecideActionOptions = Readonly<{
	type: string;
	/** The raw `--input` JSON, already read from its file or stdin. */
	input?: string;
	/** `key=value` pairs for `state.trusted`. */
	trusted?: readonly string[];
	/** `key=value` pairs for `state.untrusted`. */
	untrusted?: readonly string[];
	cwd: string;
	/** Home directory for the user policy layer. */
	home: string;
}>;

type DecideDeps = Readonly<{
	fs: FsPort;
	clock: ClockPort;
	/** The repository root for `cwd`, or `""` outside a repository. */
	repoRoot: (cwd: string) => Promise<string>;
}>;

type CommandError = Readonly<{
	kind: "invalid_input" | "policy" | DecideError["kind"] | "unknown_type";
	message: string;
}>;

type DecideData = Readonly<{
	type: DecisionType;
	/** The first decision's answer as a string: what a `switch` routes on. */
	verdict: string;
	confidence: number;
	decisions: readonly Decision[];
}>;

type DecideEnvelope = Readonly<{
	data: DecideData | null;
	error: CommandError | null;
	meta: Readonly<{ command: "decide"; type: string }>;
}>;

type DecideOutcome = Readonly<{ output: DecideEnvelope; exitCode: number }>;

type Fields = Readonly<Record<string, unknown>>;

type Parsed<T> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: CommandError }>;

const defaultDeps: DecideDeps = {
	fs: nodeFs,
	clock: { now: () => Date.now() },
	repoRoot: (cwd) => getRepoRoot(cwd),
};

// ── Input parsing ───────────────────────────────────────────────────────────

function invalidInput(message: string): Parsed<never> {
	return { ok: false, error: { kind: "invalid_input", message } };
}

function isFields(value: unknown): value is Fields {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `key=value`, the value read as JSON when it parses and kept as text otherwise. */
function parseAssignments(
	pairs: readonly string[],
	flag: string,
): Parsed<Fields> {
	const fields: Record<string, unknown> = {};
	for (const pair of pairs) {
		const eq = pair.indexOf("=");
		if (eq <= 0) {
			return invalidInput(`${flag} expects key=value, got "${pair}"`);
		}
		const raw = pair.slice(eq + 1);
		let value: unknown = raw;
		try {
			value = JSON.parse(raw);
		} catch {
			// Not JSON: the literal text.
		}
		fields[pair.slice(0, eq)] = value;
	}
	return { ok: true, value: fields };
}

function parseQuestion(value: unknown, index: number): Parsed<Question> {
	const where = `questions[${index}]`;
	if (!isFields(value) || typeof value.id !== "string") {
		return invalidInput(`${where} must be an object with a string id`);
	}
	const { id } = value;
	switch (value.kind) {
		case "bool":
			return { ok: true, value: { kind: "bool", id } };
		case "choice": {
			const { options } = value;
			if (
				!Array.isArray(options) ||
				!options.every((o) => typeof o === "string")
			) {
				return invalidInput(`${where}.options must be a list of strings`);
			}
			return { ok: true, value: { kind: "choice", id, options } };
		}
		case "score": {
			const { min, max } = value;
			if (typeof min !== "number" || typeof max !== "number") {
				return invalidInput(`${where} needs numeric min and max`);
			}
			return { ok: true, value: { kind: "score", id, min, max } };
		}
		default:
			return invalidInput(`${where}.kind must be bool, choice or score`);
	}
}

type Input = Readonly<{
	trusted: Fields;
	untrusted: Fields;
	questions: readonly Question[] | undefined;
}>;

function parseInput(raw: string | undefined): Parsed<Input> {
	if (raw === undefined) {
		return {
			ok: true,
			value: { trusted: {}, untrusted: {}, questions: undefined },
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		return invalidInput(
			`--input is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	if (!isFields(parsed)) return invalidInput("--input must be a JSON object");
	const state = parsed.state ?? {};
	if (!isFields(state)) return invalidInput("--input state must be an object");
	const trusted = state.trusted ?? {};
	const untrusted = state.untrusted ?? {};
	if (!isFields(trusted) || !isFields(untrusted)) {
		return invalidInput(
			"--input state.trusted and state.untrusted must be objects",
		);
	}
	if (parsed.questions === undefined) {
		return { ok: true, value: { trusted, untrusted, questions: undefined } };
	}
	if (!Array.isArray(parsed.questions)) {
		return invalidInput("--input questions must be a list");
	}
	const questions: Question[] = [];
	for (const [i, q] of parsed.questions.entries()) {
		const question = parseQuestion(q, i);
		if (!question.ok) return question;
		questions.push(question.value);
	}
	return { ok: true, value: { trusted, untrusted, questions } };
}

/** One choice question over the type's fixed options, when it has them. */
function defaultQuestions(type: DecisionType): Parsed<readonly Question[]> {
	const { options, kinds } = DECISION_CATALOG[type];
	if (options !== undefined && kinds.includes("choice")) {
		return {
			ok: true,
			value: [{ kind: "choice", id: "verdict", options: [...options] }],
		};
	}
	return invalidInput(
		`${type} has no fixed options: pass its questions with --input`,
	);
}

function isDecisionType(type: string): type is DecisionType {
	return Object.hasOwn(DECISION_CATALOG, type);
}

function describePolicyErrors(errors: readonly PolicyError[]): string {
	return errors
		.map(
			(e) => `${e.file ?? e.source}${e.path ? ` ${e.path}` : ""}: ${e.message}`,
		)
		.join("; ");
}

function describeDecideError(error: DecideError): string {
	switch (error.kind) {
		case "unknown_type":
			return `unknown decision type ${error.type}`;
		case "invalid_question":
			return error.questionId
				? `question ${error.questionId}: ${error.message}`
				: error.message;
		case "no_backend":
			return `no ${error.backend} backend is registered for ${error.type}`;
		case "unsupported":
		case "backend_failed":
			return `the ${error.backend} backend cannot answer ${error.type}: ${error.message}`;
		case "invalid_answer":
			return `the ${error.backend} backend gave an invalid answer to ${error.questionId || error.type}: ${error.message}`;
		default: {
			const unreachable: never = error;
			return unreachable;
		}
	}
}

// ── Core action (testable) ──────────────────────────────────────────────────

function failed(
	type: string,
	error: CommandError,
	exitCode: number,
): DecideOutcome {
	return {
		output: { data: null, error, meta: { command: "decide", type } },
		exitCode,
	};
}

/** Answers the decision and returns the envelope to print with its exit code. */
export async function decideAction(
	options: DecideActionOptions,
	deps: DecideDeps = defaultDeps,
): Promise<DecideOutcome> {
	const { type } = options;
	if (!isDecisionType(type)) {
		return failed(
			type,
			{
				kind: "unknown_type",
				message: `unknown decision type "${type}"; one of: ${Object.keys(DECISION_CATALOG).join(", ")}`,
			},
			EXIT_CONFIG_ERROR,
		);
	}

	const input = parseInput(options.input);
	if (!input.ok) return failed(type, input.error, EXIT_CONFIG_ERROR);
	const trusted = parseAssignments(options.trusted ?? [], "--trusted");
	if (!trusted.ok) return failed(type, trusted.error, EXIT_CONFIG_ERROR);
	const untrusted = parseAssignments(options.untrusted ?? [], "--untrusted");
	if (!untrusted.ok) return failed(type, untrusted.error, EXIT_CONFIG_ERROR);
	const questions =
		input.value.questions === undefined
			? defaultQuestions(type)
			: { ok: true as const, value: input.value.questions };
	if (!questions.ok) return failed(type, questions.error, EXIT_CONFIG_ERROR);

	// The gate's layering: defaults < user < repo. An unreadable or invalid
	// layer is an error, never a silent default.
	const root = (await deps.repoRoot(options.cwd)) || options.cwd;
	const user = await readUserPolicy({ fs: deps.fs }, options.home);
	const policy = user.ok
		? await loadPolicy({ fs: deps.fs }, root, user.value)
		: user;
	if (!policy.ok) {
		return failed(
			type,
			{ kind: "policy", message: describePolicyErrors(policy.error) },
			EXIT_CONFIG_ERROR,
		);
	}

	const decided = decide(
		{ clock: deps.clock, policy: policy.value, backends: DEFAULT_REGISTRY },
		{
			type,
			state: {
				trusted: { ...input.value.trusted, ...trusted.value },
				untrusted: { ...input.value.untrusted, ...untrusted.value },
			},
			questions: questions.value,
		},
	);
	if (!decided.ok) {
		const exitCode =
			decided.error.kind === "invalid_question"
				? EXIT_CONFIG_ERROR
				: EXIT_TOOL_FAILURE;
		return failed(
			type,
			{ kind: decided.error.kind, message: describeDecideError(decided.error) },
			exitCode,
		);
	}
	const [first] = decided.value;
	if (first === undefined) {
		return failed(
			type,
			{ kind: "invalid_answer", message: "decide returned no decision" },
			EXIT_TOOL_FAILURE,
		);
	}
	return {
		output: {
			data: {
				type,
				verdict: String(first.answer),
				confidence: first.confidence,
				decisions: decided.value,
			},
			error: null,
			meta: { command: "decide", type },
		},
		exitCode: EXIT_PASSED,
	};
}

// ── Commander command ───────────────────────────────────────────────────────

function collect(value: string, previous: readonly string[]): string[] {
	return [...previous, value];
}

type CommandOptions = Readonly<{
	type: string;
	input?: string;
	trusted: readonly string[];
	untrusted: readonly string[];
}>;

/** Reads `--input` (a file, or `-` for stdin) and runs `decideAction` here. */
async function runDecide(opts: CommandOptions): Promise<DecideOutcome> {
	let input: string | undefined;
	try {
		if (opts.input !== undefined) {
			input =
				opts.input === "-"
					? await Bun.stdin.text()
					: await readFile(opts.input, "utf-8");
		}
	} catch (e) {
		const message = `cannot read --input ${opts.input}: ${e instanceof Error ? e.message : String(e)}`;
		return failed(
			opts.type,
			{ kind: "invalid_input", message },
			EXIT_CONFIG_ERROR,
		);
	}
	return decideAction({
		type: opts.type,
		input,
		trusted: opts.trusted,
		untrusted: opts.untrusted,
		cwd: process.cwd(),
		home: processEnv.get("HOME") || processEnv.get("USERPROFILE") || homedir(),
	});
}

function summary(output: DecideEnvelope): string {
	if (output.data === null) {
		return `maina decide: ${output.error?.message ?? "no decision"}`;
	}
	const { verdict, confidence, decisions } = output.data;
	const backend = decisions[0]?.backend.id ?? "unknown";
	return `${verdict} (confidence ${confidence.toFixed(2)}, ${backend} backend)`;
}

export function decideCommand(): Command {
	return new Command("decide")
		.description(
			"Answer one decision (e.g. action.risk) with your policy; --json for workflows",
		)
		.requiredOption("--type <type>", "Decision type, such as action.risk")
		.option(
			"--input <file>",
			"JSON request { state?, questions? }; - reads stdin",
		)
		.option(
			"--trusted <key=value>",
			"A trusted state field (repeatable)",
			collect,
			[],
		)
		.option(
			"--untrusted <key=value>",
			"An untrusted state field (repeatable)",
			collect,
			[],
		)
		.option("--json", "Print a { data, error, meta } envelope")
		.action(
			async (opts: {
				type: string;
				input?: string;
				trusted: string[];
				untrusted: string[];
				json?: boolean;
			}) => {
				const outcome = await runDecide(opts);
				process.stdout.write(
					opts.json
						? `${JSON.stringify(outcome.output, null, 2)}\n`
						: `${summary(outcome.output)}\n`,
				);
				process.exitCode = outcome.exitCode;
			},
		);
}
