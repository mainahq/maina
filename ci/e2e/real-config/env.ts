/**
 * Environments an agent host spawns the maina MCP server with.
 *
 * A terminal-launched agent inherits the user's shell (full PATH, bun on
 * it). A GUI-launched agent (Claude desktop, Cursor from the Dock, Codex
 * from an IDE) does not: it gets the PATH of the session manager, which
 * never contains `~/.bun/bin`, `/opt/homebrew/bin` or any npm prefix.
 * That gap is what turns `#!/usr/bin/env bun` into exit 127 (P2).
 *
 * Pure functions only; callers pass the shell env and platform in.
 */

import type { Result } from "./types";

export type Os = "linux" | "darwin";

export type EnvMode = "minimal" | "gui" | "full";

export type EnvVars = Readonly<Record<string, string>>;

/**
 * PATH a GUI-launched process inherits.
 *   - darwin: launchd's default for apps started from Finder/Dock.
 *   - linux: systemd's default user-session PATH (desktop launchers).
 */
export const GUI_PATH: Readonly<Record<Os, string>> = {
	darwin: "/usr/bin:/bin:/usr/sbin:/sbin",
	linux: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
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

/** Reproduces the PATH of a GUI-launched agent on `os`. */
export function minimalEnv(os: Os): EnvVars {
	return { PATH: GUI_PATH[os] };
}

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
	if (platform === "darwin" || platform === "linux") {
		return { ok: true, value: platform };
	}
	return { ok: false, error: `unsupported platform: ${platform}` };
}
