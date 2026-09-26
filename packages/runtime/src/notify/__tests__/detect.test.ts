/**
 * Which terminal a notification is for (FR-RET-6, #351), from the documented
 * environment signals only: Warp's `TERM_PROGRAM=WarpTerminal`, the generic
 * terminals that document an OSC notification, and nothing anywhere else.
 */

import { describe, expect, test } from "bun:test";
import { detectTerminal } from "../detect";

describe("detectTerminal", () => {
	test("Warp is detected from TERM_PROGRAM=WarpTerminal", () => {
		expect(detectTerminal({ TERM_PROGRAM: "WarpTerminal" })).toEqual({
			kind: "warp",
		});
	});

	test("Warp is detected on its documented signal alone, not its internals", () => {
		// Warp's own agent plugins read these; maina must not need them.
		expect(
			detectTerminal({
				TERM_PROGRAM: "WarpTerminal",
				WARP_CLI_AGENT_PROTOCOL_VERSION: undefined,
				WARP_CLIENT_VERSION: undefined,
			}),
		).toEqual({ kind: "warp" });
		// And they never make a terminal Warp on their own.
		expect(
			detectTerminal({
				WARP_CLI_AGENT_PROTOCOL_VERSION: "1",
				WARP_CLIENT_VERSION: "v0.2026.09.20.08.00.stable_00",
				WARP_IS_LOCAL_SHELL_SESSION: "1",
			}),
		).toEqual({ kind: "none" });
	});

	test("generic terminals with a documented OSC notification", () => {
		expect(detectTerminal({ TERM_PROGRAM: "iTerm.app" })).toEqual({
			kind: "generic",
			osc: "9",
		});
		expect(detectTerminal({ TERM_PROGRAM: "WezTerm" })).toEqual({
			kind: "generic",
			osc: "9",
		});
		expect(detectTerminal({ TERM_PROGRAM: "ghostty" })).toEqual({
			kind: "generic",
			osc: "777",
		});
		expect(detectTerminal({ WT_SESSION: "5c1c2a4e" })).toEqual({
			kind: "generic",
			osc: "9",
		});
	});

	test("nothing outside supported terminals", () => {
		for (const env of [
			{},
			{ TERM_PROGRAM: "Apple_Terminal" },
			{ TERM_PROGRAM: "vscode" },
			{ TERM_PROGRAM: "" },
			{ TERM: "xterm-256color" },
		]) {
			expect(detectTerminal(env), JSON.stringify(env)).toEqual({
				kind: "none",
			});
		}
	});

	test("nothing inside a multiplexer, which swallows the sequence", () => {
		expect(
			detectTerminal({ TERM_PROGRAM: "tmux", TMUX: "/tmp/tmux-501/default" }),
		).toEqual({ kind: "none" });
		// An old tmux leaves the outer TERM_PROGRAM in place.
		expect(
			detectTerminal({
				TERM_PROGRAM: "WarpTerminal",
				TMUX: "/tmp/tmux-501/default,1,0",
			}),
		).toEqual({ kind: "none" });
		expect(
			detectTerminal({ TERM_PROGRAM: "iTerm.app", STY: "123.pts-0.host" }),
		).toEqual({ kind: "none" });
	});

	test("MAINA_NOTIFY=off turns notifications off everywhere", () => {
		for (const value of ["off", "0", "false", "OFF"]) {
			expect(
				detectTerminal({ TERM_PROGRAM: "WarpTerminal", MAINA_NOTIFY: value }),
				value,
			).toEqual({ kind: "none" });
		}
		expect(
			detectTerminal({ TERM_PROGRAM: "WarpTerminal", MAINA_NOTIFY: "on" }),
		).toEqual({ kind: "warp" });
	});
});
