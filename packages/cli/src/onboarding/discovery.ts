/**
 * Teammate discovery in agent instruction files (FR-RET-4).
 *
 * When a repo commits a Maina policy, a teammate who clones it may not have
 * Maina installed, so none of its code can run for them. Their agent still
 * reads the instruction files, so `maina setup` puts an install hint in the
 * managed region of each one. The hint is a shell check the agent runs: it
 * prints the install command only when `maina` is not on the PATH, and only
 * once per developer (a marker under `~/.maina/`, never in the repo).
 */

import { type ProcessPort, systemProcess } from "@mainahq/core";

/** The repo policy whose presence in HEAD turns the hint on. */
const POLICY_PATH = ".maina/policy.json";

export const INSTALL_HINT_HEADING = "## Maina for teammates";

const INSTALL_MESSAGE =
	"This repo commits a Maina policy (.maina/policy.json) for agent actions and PR receipts, but maina is not installed here. Install it: npm install -g @mainahq/cli && maina setup";

/**
 * POSIX sh one-liner: silent when `maina` is installed or the developer has
 * already seen the hint; otherwise prints it and records that it was shown.
 */
export function installHintScript(): string {
	return [
		"command -v maina >/dev/null 2>&1 || {",
		'm="$HOME/.maina/install-hint-shown";',
		'[ -f "$m" ] || {',
		`echo "${INSTALL_MESSAGE}";`,
		'mkdir -p "$HOME/.maina" 2>/dev/null && : > "$m";',
		"}; }",
	].join(" ");
}

/** The managed-region section that carries the hint. */
export function renderInstallHint(): string {
	return [
		INSTALL_HINT_HEADING,
		"",
		`This repo commits a Maina policy (\`${POLICY_PATH}\`). Once per session, run this check and pass on anything it prints to the developer. It prints only when \`maina\` is not installed, and only once per developer:`,
		"",
		"```sh",
		installHintScript(),
		"```",
		"",
	].join("\n");
}

/**
 * True when `.maina/policy.json` is committed at HEAD in `cwd`. An
 * untracked or merely staged file, a repo without commits, or no repo at
 * all is false.
 */
export async function isPolicyCommitted(
	cwd: string,
	proc: ProcessPort = systemProcess,
): Promise<boolean> {
	const result = await proc.spawn(
		["git", "ls-tree", "--name-only", "HEAD", "--", POLICY_PATH],
		{ cwd, timeoutMs: 5_000 },
	);
	return (
		result.ok &&
		result.value.exitCode === 0 &&
		result.value.stdout.trim().length > 0
	);
}
