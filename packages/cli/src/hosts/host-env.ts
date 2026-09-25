/**
 * The environment an AI host spawns the maina MCP server with.
 *
 * A terminal-launched agent inherits the user's shell (full PATH, bun on
 * it). A GUI-launched agent (Claude desktop, Cursor from the Dock, Codex
 * from an IDE) does not: it gets the PATH of the session manager, which
 * never contains `~/.bun/bin`, `/opt/homebrew/bin` or any npm prefix.
 * That gap is what turns `#!/usr/bin/env bun` into exit 127 (P2).
 *
 * Shared by `maina doctor` (which launches each configured entry under
 * it) and the real-config e2e matrix (`ci/e2e/real-config/env.ts`).
 * Pure: callers pass the platform in.
 */

type Os = "linux" | "darwin";

export type EnvVars = Readonly<Record<string, string>>;

/**
 * PATH a GUI-launched process inherits.
 *   - darwin: launchd's default for apps started from Finder/Dock.
 *   - linux: systemd's default user-session PATH (desktop launchers).
 */
const GUI_PATH: Readonly<Record<Os, string>> = {
	darwin: "/usr/bin:/bin:/usr/sbin:/sbin",
	linux: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
};

/** Reproduces the PATH of a GUI-launched agent on `os`. */
export function minimalEnv(os: Os): { readonly PATH: string } {
	return { PATH: GUI_PATH[os] };
}

/** The `Os` whose GUI env is known for `platform`, or null. */
export function hostOs(platform: string): Os | null {
	return platform === "darwin" || platform === "linux" ? platform : null;
}
