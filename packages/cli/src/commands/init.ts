/**
 * `maina init` — deprecated alias of `maina setup` (#288).
 *
 * There is one onboarding flow. `init` accepts every `setup` flag, prints a
 * deprecation notice on stderr (stdout stays clean for `--json`/`--ci`) and
 * runs the same command. The 1.x `--force` and `--install` flags are still
 * accepted so old scripts keep working, but they are not honoured: setup
 * never overwrites files, and `maina doctor` lists missing tools.
 */

import { Command } from "commander";
import {
	addSetupOptions,
	runSetupCommand,
	type SetupCommandOptions,
} from "./setup";

export const INIT_DEPRECATION_NOTICE =
	"`maina init` is deprecated and will be removed in a future major release; running `maina setup` instead.";

interface InitCommandOptions extends SetupCommandOptions {
	force?: boolean;
	install?: boolean;
}

interface InitCommandDeps {
	readonly run: (opts: SetupCommandOptions) => Promise<void>;
	readonly warn: (message: string) => void;
}

const defaultDeps: InitCommandDeps = {
	run: runSetupCommand,
	warn: (message) => {
		process.stderr.write(`${message}\n`);
	},
};

export function initCommand(deps: InitCommandDeps = defaultDeps): Command {
	return addSetupOptions(
		new Command("init").description(
			"Deprecated alias of `maina setup` (same flags)",
		),
	)
		.option("--force", "Ignored: setup never overwrites files")
		.option("--install", "Ignored: run `maina doctor` to see missing tools")
		.action(async (opts: InitCommandOptions) => {
			deps.warn(INIT_DEPRECATION_NOTICE);
			if (opts.force === true) {
				deps.warn(
					"`--force` is ignored: setup never overwrites files. Use `maina setup --reset` to regenerate .maina/.",
				);
			}
			if (opts.install === true) {
				deps.warn(
					"`--install` is ignored: run `maina doctor` to see which verification tools are missing.",
				);
			}
			const { force: _force, install: _install, ...setupOpts } = opts;
			await deps.run(setupOpts);
		});
}
