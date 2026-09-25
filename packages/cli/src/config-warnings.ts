/**
 * CLI surface for `maina.config.{ts,js}` validation errors (#393). The
 * loader keeps every valid field and drops only the invalid ones; this
 * module makes sure the user hears about each dropped field instead of
 * losing it silently.
 */

import { type ConfigError, loadConfigModule } from "@mainahq/core";

function describeError(error: ConfigError): string {
	return `  - ${error.path === "" ? "(root)" : error.path}: ${error.message}`;
}

function formatFileWarnings(
	file: string,
	errors: readonly ConfigError[],
): string {
	// A root-level error (unparseable module, non-object export, or a layer
	// the salvage could not isolate) means nothing in this file was kept.
	const unloadable = errors.some((e) => e.kind !== "invalid" || e.path === "");
	if (unloadable) {
		return [
			`maina: could not load ${file}; using the defaults:`,
			...errors.map(describeError),
		].join("\n");
	}
	const noun = errors.length === 1 ? "entry" : "entries";
	return [
		`maina: ignored ${errors.length} invalid ${noun} in ${file} (the rest of the config still applies):`,
		...errors.map(describeError),
	].join("\n");
}

/** Human-readable warning for config errors, grouped by file; `""` when there are none. */
export function formatConfigWarnings(errors: readonly ConfigError[]): string {
	if (errors.length === 0) return "";
	const files = [...new Set(errors.map((e) => e.file))];
	const blocks = files.map((file) =>
		formatFileWarnings(
			file,
			errors.filter((e) => e.file === file),
		),
	);
	return `${blocks.join("\n")}\n`;
}

/**
 * Loads the `maina.config.*` found from `root` and writes a warning for
 * every field the loader had to drop. Returns the errors so callers can
 * also report them in machine-readable output.
 */
export async function warnOnConfigErrors(
	root: string,
	write: (text: string) => void,
): Promise<readonly ConfigError[]> {
	const { errors } = await loadConfigModule(root);
	const text = formatConfigWarnings(errors);
	if (text !== "") write(text);
	return errors;
}
