/**
 * The credential proxy (FR-SBX-3): a worker never holds a real secret, in
 * its environment or in a file. Pure: no I/O.
 *
 * A declared credential is masked: inside the sandbox the variable holds a
 * per-session stand-in, and the sandbox's egress proxy swaps the real value
 * in only on requests to the credential's hosts (TLS is terminated for
 * that, with a CA only the sandbox trusts). The real value lives in the
 * sandbox runtime's own environment, outside the sandbox.
 *
 * Everything else the harness's environment carries is withheld unless it
 * is on a short list of what a process needs to run (`PATH`, `HOME`,
 * locale, terminal, temp dir) or the launch set it itself. That is a deny
 * by default: an ambient `GITHUB_TOKEN` or cloud key the user happened to
 * export never reaches an agent, whatever it is called.
 */

import type { Result } from "@mainahq/core";
import { isHostPattern } from "./policy-to-sandbox";
import type { Credential, SandboxError } from "./port";

/** One `credentials.envVars` entry of the sandbox runtime's settings. */
export type EnvVarRule = Readonly<{
	name: string;
	mode: "mask" | "deny";
	injectHosts?: readonly string[];
}>;

export type CredentialPlan = Readonly<{
	/** Real values, for the sandbox runtime's own environment only. */
	hostEnv: Readonly<Record<string, string>>;
	/** Masks for the credentials, denies for everything else. */
	envVars: readonly EnvVarRule[];
	/** Every credential's hosts: the worker must be able to reach them. */
	hosts: readonly string[];
}>;

/** What a process needs to run; none of it is a secret. */
const PASSTHROUGH = new Set([
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"PWD",
	"SHLVL",
	"LANG",
	"LANGUAGE",
	"TZ",
	"TERM",
	"COLORTERM",
	"NO_COLOR",
	"FORCE_COLOR",
	"TMPDIR",
	"TMP",
	"TEMP",
	// CA bundles: sandbox-runtime points these at its own when it terminates TLS.
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"NODE_EXTRA_CA_CERTS",
	"REQUESTS_CA_BUNDLE",
	"CURL_CA_BUNDLE",
	"GIT_SSL_CAINFO",
]);

const PASSTHROUGH_PREFIXES = ["LC_", "XDG_"];

/**
 * Proxy settings are sandbox-runtime's: it reads the host's as its parent
 * proxy and points the worker's at itself.
 */
const PROXY_VARIABLE = /^(https?|all|no|ftp|grpc|rsync)_proxy$/i;

/** The debug switch sandbox-runtime sets on itself to log decisions. */
const SANDBOX_DEBUG = "SRT_DEBUG";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function passesThrough(name: string): boolean {
	return (
		PASSTHROUGH.has(name) ||
		PASSTHROUGH_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
		PROXY_VARIABLE.test(name) ||
		name === SANDBOX_DEBUG
	);
}

function invalid(message: string): Result<never, SandboxError> {
	return { ok: false, error: { code: "invalid_options", message } };
}

function checkCredential(
	credential: Credential,
	launchEnv: Readonly<Record<string, string>>,
): string | undefined {
	const { name, value, hosts } = credential;
	if (!ENV_NAME.test(name))
		return `"${name}" is not an environment variable name`;
	if (value === "") return `credential ${name} is empty`;
	if (hosts.length === 0) {
		return `credential ${name} names no host: it could never be sent anywhere`;
	}
	const bad = hosts.find((host) => !isHostPattern(host));
	if (bad !== undefined) return `credential ${name}: "${bad}" is not a host`;
	if (Object.hasOwn(launchEnv, name)) {
		return `credential ${name} is also set by the launch, which would bypass the mask`;
	}
	return undefined;
}

/**
 * Plans how `credentials` reach the worker masked, and which of `env` (the
 * environment the sandbox runtime inherits) the worker must not see.
 * `launchEnv` is the launch's own environment, which passes through.
 */
export function planCredentials(
	credentials: readonly Credential[],
	env: Readonly<Record<string, string | undefined>>,
	launchEnv: Readonly<Record<string, string>>,
): Result<CredentialPlan, SandboxError> {
	const declared = new Set<string>();
	for (const credential of credentials) {
		const problem = checkCredential(credential, launchEnv);
		if (problem !== undefined) return invalid(problem);
		if (declared.has(credential.name)) {
			return invalid(`credential ${credential.name} is declared twice`);
		}
		declared.add(credential.name);
	}

	const masks: EnvVarRule[] = credentials.map(({ name, hosts }) => ({
		name,
		mode: "mask",
		injectHosts: [...hosts],
	}));
	const denies: EnvVarRule[] = Object.entries(env)
		.filter(
			([name, value]) =>
				value !== undefined &&
				!declared.has(name) &&
				!Object.hasOwn(launchEnv, name) &&
				!passesThrough(name),
		)
		.map(([name]) => ({ name, mode: "deny" }));

	return {
		ok: true,
		value: {
			hostEnv: Object.fromEntries(
				credentials.map(({ name, value }) => [name, value]),
			),
			envVars: [...masks, ...denies],
			hosts: [...new Set(credentials.flatMap(({ hosts }) => hosts))],
		},
	};
}
