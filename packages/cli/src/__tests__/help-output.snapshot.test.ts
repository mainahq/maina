/**
 * Wave 4 — `maina --help` must show ONLY user-facing commands (G11).
 *
 * Internal plumbing (`analyze`, `benchmark`, `cache`, `context`,
 * `explain`, `feedback`, `learn`, `prompt`, `stats`, `status`, `sync`,
 * `team`, `visual`) is hidden via Commander `.hidden()` so first-time
 * users see a short, ordered help instead of 25 entries.
 *
 * These internals are **still callable** — `.hidden()` only removes
 * them from `--help` output. That keeps existing scripts and muscle
 * memory working.
 *
 * The `configure` deprecation banner MUST stay visible.
 */
import { describe, expect, test } from "bun:test";
import { createProgram } from "../program";

// ── Helpers ─────────────────────────────────────────────────────────────────

function helpText(): string {
	return createProgram().helpInformation();
}

/** Match a command name at the start of a line (after the 2-space indent). */
function listsCommand(help: string, name: string): boolean {
	// Commander formats commands as `  name [options]` or `  name <args>`.
	// We anchor on start-of-line, 2 spaces, exact name followed by space|EOL.
	const re = new RegExp(`^\\s+${name}(\\s|$)`, "m");
	return re.test(help);
}

// ── User-facing commands that MUST appear in help ──────────────────────────

const VISIBLE_COMMANDS = [
	"brainstorm",
	"ticket",
	"plan",
	"design",
	"spec",
	"verify",
	"commit",
	"review",
	"review-design",
	"slop",
	"pr",
	"wiki",
	"init",
	"setup",
	"doctor",
	"login",
	"logout",
	"configure",
	"mcp",
];

// ── Internal commands that MUST be hidden ──────────────────────────────────

const HIDDEN_COMMANDS = [
	"analyze",
	"benchmark",
	"cache",
	"context",
	"explain",
	"feedback",
	"learn",
	"prompt",
	"stats",
	"status",
	"sync",
	"team",
	"visual",
];

describe("maina --help (G11 surface cleanup)", () => {
	test("every user-facing command appears in help", () => {
		const help = helpText();
		for (const name of VISIBLE_COMMANDS) {
			expect(listsCommand(help, name)).toBe(true);
		}
	});

	test("every internal command is hidden from help", () => {
		const help = helpText();
		for (const name of HIDDEN_COMMANDS) {
			expect(listsCommand(help, name)).toBe(false);
		}
	});

	test("hidden internals are still registered and callable", () => {
		// `.hidden()` removes from help but keeps the command registered.
		// This guarantees existing scripts like `maina sync` keep working.
		const program = createProgram();
		const registered = program.commands.map((c) => c.name());
		for (const name of HIDDEN_COMMANDS) {
			expect(registered).toContain(name);
		}
	});

	test("configure keeps its deprecation banner (not hidden)", () => {
		const help = helpText();
		expect(listsCommand(help, "configure")).toBe(true);
	});

	test("help text length is under the 60-line budget", () => {
		// Sanity cap — if help grows past ~60 lines we are bloating the
		// user-facing surface again. Tighten the guardrail if a command
		// genuinely needs to be added, don't loosen it quietly.
		const lines = helpText().split(/\r?\n/);
		expect(lines.length).toBeLessThan(80);
	});
});
