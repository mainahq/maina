/**
 * The input of the one-shot job process (`main.ts`): which job to run,
 * from argv, and the App's credentials, from the environment.
 *
 *   <kind> --repo <owner/name> --pr <number> --installation <id>
 *          [--depth <n>]            impact
 *          [--paths <dir,dir>]      spec_check
 *          --request <json>         decide
 *
 * `MAINA_GITHUB_APP_ID` and `MAINA_GITHUB_APP_PRIVATE_KEY` (PEM; `\n`
 * escapes allowed, for a key kept on one line) are required;
 * `MAINA_GITHUB_API_URL` points at GitHub Enterprise. Errors name the
 * flag or variable at fault.
 */

import type { DecideRequest, Result } from "@mainahq/core";
import { JOB_KINDS, type JobRequest } from "./jobs";

type Invocation = Readonly<{
	appId: string;
	privateKey: string;
	apiUrl?: string;
	request: JobRequest;
}>;

type InvocationError = Readonly<{ name: string; message: string }>;

const FLAGS = [
	"--repo",
	"--pr",
	"--installation",
	"--depth",
	"--paths",
	"--request",
] as const;

type Flag = (typeof FLAGS)[number];

const fail = (
	name: string,
	message: string,
): Result<never, InvocationError> => ({
	ok: false,
	error: { name, message },
});

const isFlag = (arg: string): arg is Flag =>
	(FLAGS as readonly string[]).includes(arg);

function parseArgv(
	argv: readonly string[],
): Result<
	Readonly<{ kind: string | undefined; flags: ReadonlyMap<Flag, string> }>,
	InvocationError
> {
	const flags = new Map<Flag, string>();
	let kind: string | undefined;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i] ?? "";
		if (!arg.startsWith("--")) {
			if (kind !== undefined) return fail(arg, `unexpected argument ${arg}`);
			kind = arg;
			continue;
		}
		if (!isFlag(arg)) return fail(arg, `unknown flag ${arg}`);
		const value = argv[i + 1];
		if (value === undefined) return fail(arg, `${arg} needs a value`);
		flags.set(arg, value);
		i += 1;
	}
	return { ok: true, value: { kind, flags } };
}

const positiveInt = (raw: string | undefined): number | undefined =>
	raw !== undefined && /^[1-9]\d*$/.test(raw) ? Number(raw) : undefined;

function decideRequest(raw: string | undefined): DecideRequest | undefined {
	if (raw === undefined) return undefined;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof (parsed as { type?: unknown }).type === "string" &&
			Array.isArray((parsed as { questions?: unknown }).questions)
		) {
			return parsed as DecideRequest;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

const APP_SECRET = /^MAINA_GITHUB_APP_/;

/**
 * The App's credential variables in `env` (`MAINA_GITHUB_APP_*`): the job
 * process drops them from its own environment once read, so no child
 * process running over a pull request's code inherits them.
 */
export function appSecretNames(
	env: Readonly<Record<string, string | undefined>>,
): string[] {
	return Object.keys(env).filter((name) => APP_SECRET.test(name));
}

export function readJobInvocation(
	argv: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
): Result<Invocation, InvocationError> {
	const parsed = parseArgv(argv);
	if (!parsed.ok) return parsed;
	const { kind, flags } = parsed.value;

	const repo = /^([\w.-]+)\/([\w.-]+)$/.exec(flags.get("--repo") ?? "");
	if (repo === null) return fail("--repo", "--repo must be owner/name");
	const pullNumber = positiveInt(flags.get("--pr"));
	if (pullNumber === undefined) {
		return fail("--pr", "--pr must be a pull request number");
	}
	const installationId = positiveInt(flags.get("--installation"));
	if (installationId === undefined) {
		return fail("--installation", "--installation must be an installation id");
	}
	const target = {
		repository: { owner: repo[1] ?? "", name: repo[2] ?? "" },
		pullNumber,
		installationId,
	};

	let request: JobRequest;
	switch (kind) {
		case "verify":
		case "triage":
			request = { kind, ...target };
			break;
		case "impact": {
			const raw = flags.get("--depth");
			const depth = positiveInt(raw);
			if (raw !== undefined && depth === undefined) {
				return fail("--depth", "--depth must be a positive integer");
			}
			request = { kind, ...target, ...(depth !== undefined ? { depth } : {}) };
			break;
		}
		case "spec_check": {
			const paths = flags
				.get("--paths")
				?.split(",")
				.map((p) => p.trim())
				.filter((p) => p !== "");
			request = { kind, ...target, ...(paths !== undefined ? { paths } : {}) };
			break;
		}
		case "decide": {
			const decide = decideRequest(flags.get("--request"));
			if (decide === undefined) {
				return fail(
					"--request",
					"--request must be a JSON decide request with a type and questions",
				);
			}
			request = { kind, ...target, request: decide };
			break;
		}
		default:
			return fail(
				"kind",
				`unknown job ${JSON.stringify(kind ?? "")}; expected one of ${JOB_KINDS.join(", ")}`,
			);
	}

	const appId = env.MAINA_GITHUB_APP_ID;
	if (appId === undefined || appId === "") {
		return fail("MAINA_GITHUB_APP_ID", "the GitHub App id is required");
	}
	const privateKey = env.MAINA_GITHUB_APP_PRIVATE_KEY;
	if (privateKey === undefined || privateKey === "") {
		return fail(
			"MAINA_GITHUB_APP_PRIVATE_KEY",
			"the GitHub App private key (PEM) is required",
		);
	}
	const apiUrl = env.MAINA_GITHUB_API_URL;
	return {
		ok: true,
		value: {
			appId,
			privateKey: privateKey.replaceAll("\\n", "\n"),
			...(apiUrl !== undefined && apiUrl !== "" ? { apiUrl } : {}),
			request,
		},
	};
}
