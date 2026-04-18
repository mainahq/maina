/**
 * `maina configure` — DEPRECATED alias for `maina setup --update`.
 *
 * The interactive constitution editor moved into the unified setup wizard
 * (issue #174). This command stays as a thin shim so existing scripts and
 * muscle memory keep working while users migrate.
 *
 * @since v1.3
 * @removed v1.5
 */

import { Command } from "commander";
import { type SetupActionOptions, setupAction } from "./setup";

export interface ConfigureActionOptions {
	cwd?: string;
	/** Alias for `setup --ci` (and `--yes`) — used by non-interactive scripts. */
	noInteractive?: boolean;
}

export interface ConfigureActionDeps {
	/** Write sink for the deprecation banner. Defaults to `process.stderr.write`. */
	stderr?: (msg: string) => void;
	/** Setup hook, injectable for tests. Defaults to the real `setupAction`. */
	setupFn?: (opts: SetupActionOptions) => Promise<void>;
}

const DEPRECATION_NOTE =
	"⚠  `maina configure` is deprecated since v1.3 and will be removed in v1.5.\n" +
	"   Use `maina setup --update` instead (or `maina setup --update --ci` for non-interactive).\n";

/**
 * Delegates to `setupAction({ mode: "update" })` and prints a deprecation
 * banner to stderr so CI stdout stays clean.
 */
export async function configureAction(
	options: ConfigureActionOptions = {},
	deps: ConfigureActionDeps = {},
): Promise<void> {
	const stderr = deps.stderr ?? ((m: string) => process.stderr.write(m));
	const setupFn = deps.setupFn ?? setupAction;

	stderr(DEPRECATION_NOTE);

	const setupOpts: SetupActionOptions = {
		cwd: options.cwd,
		mode: "update",
		ci: !!options.noInteractive,
		yes: !!options.noInteractive,
	};

	await setupFn(setupOpts);
}

export function configureCommand(): Command {
	return new Command("configure")
		.description(
			"(deprecated) alias for `maina setup --update` — removed in v1.5",
		)
		.option(
			"--no-interactive",
			"Run non-interactively (alias for `setup --update --ci`)",
		)
		.action(async (options) => {
			await configureAction({
				noInteractive: options.interactive === false,
			});
		});
}
