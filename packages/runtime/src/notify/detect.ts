/**
 * Which terminal a notification is for (FR-RET-6, #351). Pure: reads only
 * the environment it is given, and only the signals each terminal
 * documents (ADR 0049):
 *
 *   Warp               `TERM_PROGRAM=WarpTerminal`
 *   iTerm2, WezTerm    `TERM_PROGRAM=iTerm.app` / `WezTerm`: OSC 9
 *   Ghostty            `TERM_PROGRAM=ghostty`: OSC 777
 *   Windows Terminal   `WT_SESSION`: OSC 9
 *
 * Anything else is `none`, and so is a session inside tmux or GNU screen,
 * which swallow the sequence unless the user configured passthrough, and a
 * user who set `MAINA_NOTIFY=off`.
 */

export type Env = Readonly<Record<string, string | undefined>>;

/** The OSC a generic terminal documents for a desktop notification. */
export type GenericOsc = "9" | "777";

type NotifyTerminal =
	| Readonly<{ kind: "warp" }>
	| Readonly<{ kind: "generic"; osc: GenericOsc }>
	| Readonly<{ kind: "none" }>;

const NONE: NotifyTerminal = { kind: "none" };

/** Generic terminals by their `TERM_PROGRAM`. */
const GENERIC: Readonly<Record<string, GenericOsc>> = {
	"iTerm.app": "9",
	WezTerm: "9",
	ghostty: "777",
};

const OFF = new Set(["off", "0", "false", "no"]);

const set = (value: string | undefined): boolean =>
	value !== undefined && value !== "";

export function detectTerminal(env: Env): NotifyTerminal {
	if (OFF.has((env.MAINA_NOTIFY ?? "").toLowerCase())) return NONE;
	if (set(env.TMUX) || set(env.STY)) return NONE;
	const program = env.TERM_PROGRAM ?? "";
	if (program === "WarpTerminal") return { kind: "warp" };
	const osc = Object.hasOwn(GENERIC, program) ? GENERIC[program] : undefined;
	if (osc !== undefined) return { kind: "generic", osc };
	// Windows Terminal sets no TERM_PROGRAM of its own.
	if (program === "" && set(env.WT_SESSION))
		return { kind: "generic", osc: "9" };
	return NONE;
}
