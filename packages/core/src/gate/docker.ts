/**
 * Reads a `docker`, `podman` or `docker-compose` command line for the
 * actions the gate classifies (#614): publishing an image, deploying a
 * stack, and deleting data that no rebuild brings back.
 *
 * Volumes hold databases and uploads, so pruning or removing them is
 * `system.destructive`, as is `system prune --all`/`image prune --all`,
 * which drop every image no container uses, and `podman system reset`. A
 * plain `system prune` only clears dangling images, stopped containers and
 * build cache, so it stays clear.
 */

import type { ActionClass } from "../policy/defaults";

/** A word of the command line; `null` when the gate cannot resolve it. */
type Word = string | null;

type DockerClass = Extract<
	ActionClass,
	"package.publish" | "deploy" | "system.destructive" | "shell.opaque"
>;

/** Global options of `docker`/`podman` that take the next word as a value. */
const GLOBAL_VALUE: ReadonlySet<string> = new Set([
	"-H",
	"--host",
	"-c",
	"--context",
	"--config",
	"-l",
	"--log-level",
	"--tlscacert",
	"--tlscert",
	"--tlskey",
	"--url",
	"--connection",
	"--identity",
	"--root",
	"--runroot",
	"--storage-driver",
	"--storage-opt",
	"--tmpdir",
]);

/** `docker compose` / `docker-compose` options that take the next word as a value. */
const COMPOSE_VALUE: ReadonlySet<string> = new Set([
	"-f",
	"--file",
	"-p",
	"--project-name",
	"--project-directory",
	"--env-file",
	"--profile",
	"--ansi",
	"--progress",
	"--parallel",
]);

/** The classes of `docker …` or `podman …`, given the words after the program. */
export function classifyDocker(words: readonly Word[]): readonly DockerClass[] {
	const [group, ...rest] = afterOptions(words, GLOBAL_VALUE);
	if (group === undefined) return [];
	if (group === "push") return ["package.publish"];
	if (group === "compose") return classifyCompose(rest);
	const [action, ...args] = rest;
	if (group === "stack" && action === "deploy") return ["deploy"];
	if (asksForHelp(args)) return [];
	if (group === "volume" && (action === "rm" || action === "remove"))
		return ["system.destructive"];
	if (group === "volume" && action === "prune") return ["system.destructive"];
	if (group === "system" && action === "reset") return ["system.destructive"];
	if (group === "system" && action === "prune")
		return dropsData(args, /^-[a-z]*a/, ["--all", "--volumes"]);
	if (group === "image" && action === "prune")
		return dropsData(args, /^-[a-z]*a/, ["--all"]);
	return [];
}

/** The classes of `docker-compose …` or `docker compose …`, given the words after `compose`. */
export function classifyCompose(
	words: readonly Word[],
): readonly DockerClass[] {
	const [action, ...args] = afterOptions(words, COMPOSE_VALUE);
	if (action !== "down" || asksForHelp(args)) return [];
	// `down -v` removes the named volumes the project declares.
	return dropsData(args, /^-[a-z]*v/, ["--volumes"]);
}

/**
 * The words from the first operand on, past the leading options (and the
 * values of those in `withValue`). An unresolved word ends the scan, since
 * it could be an option or the operand.
 */
function afterOptions(
	words: readonly Word[],
	withValue: ReadonlySet<string>,
): readonly Word[] {
	let i = 0;
	while (i < words.length) {
		const w = words[i];
		if (w === null || w === undefined || !w.startsWith("-")) break;
		i += withValue.has(w) ? 2 : 1;
	}
	return words.slice(i);
}

/**
 * `system.destructive` when an option before `--` asks for the data-losing
 * variant (a short cluster matching `short`, or a long flag in `long`, bare
 * or `=true`), `shell.opaque` when an unresolved word might, else nothing.
 */
function dropsData(
	args: readonly Word[],
	short: RegExp,
	long: readonly string[],
): readonly DockerClass[] {
	const end = args.indexOf("--");
	const options = end < 0 ? args : args.slice(0, end);
	const drops = options.some(
		(a) =>
			a !== null &&
			(short.test(a) ||
				long.some((flag) => a === flag || a === `${flag}=true`)),
	);
	if (drops) return ["system.destructive"];
	return options.includes(null) ? ["shell.opaque"] : [];
}

const asksForHelp = (args: readonly Word[]): boolean =>
	args.some((a) => a === "--help" || a === "-h");
