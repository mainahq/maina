/**
 * Environments an agent host spawns the maina MCP server with, per launch
 * mode. The minimal (GUI) PATH itself is defined once, in the CLI's
 * `hosts/host-env.ts`, which `maina doctor` launches entries under too.
 *
 * Pure functions only; callers pass the shell env and platform in.
 */

import {
	type EnvVars,
	hostOs,
	minimalEnv,
} from "../../../packages/cli/src/hosts/host-env";
import type { Result } from "./types";

export type { EnvVars };
export { minimalEnv };

export type Os = NonNullable<ReturnType<typeof hostOs>>;

export type EnvMode = "minimal" | "gui" | "full";

/** PATH a GUI-launched process inherits, per OS. */
export const GUI_PATH: Readonly<Record<Os, string>> = {
	darwin: minimalEnv("darwin").PATH,
	linux: minimalEnv("linux").PATH,
};

/** Session variables a GUI launch carries; everything else is dropped. */
const GUI_SESSION_KEYS: readonly string[] = [
	"USER",
	"LOGNAME",
	"SHELL",
	"TMPDIR",
	"LANG",
	"LC_ALL",
	"XDG_RUNTIME_DIR",
	"DISPLAY",
	"__CF_USER_TEXT_ENCODING",
];

export interface HostEnvInput {
	readonly os: Os;
	/** The sandboxed HOME the case runs under. */
	readonly home: string;
	/** The user's interactive shell env (what the installer ran with). */
	readonly shellEnv: EnvVars;
}

/** The env a host passes to the MCP server it spawns, per launch mode. */
export function hostEnv(mode: EnvMode, input: HostEnvInput): EnvVars {
	switch (mode) {
		case "minimal":
			return { ...minimalEnv(input.os), HOME: input.home };
		case "gui": {
			const session: Record<string, string> = {};
			for (const key of GUI_SESSION_KEYS) {
				const value = input.shellEnv[key];
				if (value !== undefined) session[key] = value;
			}
			return { ...session, ...minimalEnv(input.os), HOME: input.home };
		}
		case "full":
			// Terminal launch: whatever the (sanitised) user shell carries.
			return { ...input.shellEnv, HOME: input.home };
		default: {
			const never: never = mode;
			return never;
		}
	}
}

/**
 * PATH of a standard bun user's interactive shell: bun's installer puts
 * `bun`, `bunx` and globally installed bins in `~/.bun/bin`.
 */
export function userShellPath(os: Os, home: string): string {
	return `${home}/.bun/bin:${GUI_PATH[os]}`;
}

export function currentOs(platform: string): Result<Os, string> {
	const os = hostOs(platform);
	return os === null
		? { ok: false, error: `unsupported platform: ${platform}` }
		: { ok: true, value: os };
}
