/**
 * Credential detection for the gate: files that hold secrets, directories
 * that store credentials, environment variable names that carry them, and
 * secret-shaped content.
 */

const segments = (path: string): readonly string[] => path.split("/");
const baseName = (path: string): string => segments(path).at(-1) ?? "";

/** `.env` files, except the templates that exist to be committed. */
function isDotEnv(name: string): boolean {
	return (
		/^\.env(\..+)?$/.test(name) &&
		!/\.(example|sample|template|defaults|dist)$/.test(name)
	);
}

/** Files whose content is a secret wherever they live. */
const SECRET_NAMES: ReadonlySet<string> = new Set([
	".netrc",
	".pgpass",
	".npmrc",
	".pypirc",
	".git-credentials",
	".htpasswd",
	"credentials.json",
]);

/** Paths (relative to any directory) that are credential files. */
const SECRET_SUFFIXES: readonly RegExp[] = [
	/(^|\/)\.aws\/(credentials|config)$/,
	/(^|\/)\.config\/gh\/hosts\.yml$/,
	/(^|\/)\.docker\/config\.json$/,
	/(^|\/)\.kube\/config$/,
	/(^|\/)\.config\/gcloud\//,
	/(^|\/)\.azure\//,
	/^\/proc\/[^/]+\/environ$/,
];

/** Directories that hold nothing but credentials. */
const CREDENTIAL_DIRS: readonly RegExp[] = [
	/(^|\/)\.ssh(\/|$)/,
	/(^|\/)\.aws(\/|$)/,
	/(^|\/)\.gnupg(\/|$)/,
	/(^|\/)\.kube(\/|$)/,
	/(^|\/)\.docker\/config\.json$/,
	/(^|\/)\.config\/gh(\/|$)/,
	/(^|\/)\.netrc$/,
	/(^|\/)\.git-credentials$/,
	/(^|\/)\.npmrc$/,
];

/** Whether reading `path` exposes a secret. */
export function isSecretPath(path: string): boolean {
	const p = path.replace(/^['"]|['"]$/g, "");
	const name = baseName(p);
	return (
		isDotEnv(name) ||
		SECRET_NAMES.has(name) ||
		/^id_(rsa|dsa|ecdsa|ed25519)$/.test(name) ||
		/\.(pem|key|p12|pfx|jks|keystore)$/.test(name) ||
		/(^|\/)\.ssh(\/|$)/.test(p) ||
		/(^|\/)\.gnupg(\/|$)/.test(p) ||
		SECRET_SUFFIXES.some((re) => re.test(p))
	);
}

/** Whether writing `path` changes a credential store (keys, auth, tokens). */
export function isCredentialStorePath(path: string): boolean {
	return CREDENTIAL_DIRS.some((re) => re.test(path));
}

const SECRET_VAR =
	/(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIALS?)/i;

export function isSecretVarName(name: string): boolean {
	return SECRET_VAR.test(name);
}

/**
 * Secret-shaped content: private keys and the token formats with a fixed
 * prefix. Generic high-entropy strings are left to the verify engine.
 */
const SECRET_CONTENT: readonly RegExp[] = [
	/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
	/\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
	/\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bnpm_[A-Za-z0-9]{36}\b/,
	/\bsk-(?:ant|or|proj)-[A-Za-z0-9_-]{20,}/,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/,
];

export function containsSecret(text: string): boolean {
	return SECRET_CONTENT.some((re) => re.test(text));
}
