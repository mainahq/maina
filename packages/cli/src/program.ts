import { flushTelemetry } from "@mainahq/core";
import { Command } from "commander";
import pkg from "../package.json";
import { analyzeCommand } from "./commands/analyze";
import { benchmarkCommand } from "./commands/benchmark";
import { brainstormCommand } from "./commands/brainstorm";
import { cacheCommand } from "./commands/cache";
import { commitCommand } from "./commands/commit";
import { configureCommand } from "./commands/configure";
import { contextCommand } from "./commands/context";
import { designCommand } from "./commands/design";
import { doctorCommand } from "./commands/doctor";
import { explainCommand } from "./commands/explain";
import { feedbackCommand } from "./commands/feedback";
import { initCommand } from "./commands/init";
import { learnCommand } from "./commands/learn";
import { loginCommand, logoutCommand } from "./commands/login";
import { mcpCommand } from "./commands/mcp";
import { planCommand } from "./commands/plan";
import { prCommand } from "./commands/pr";
import { promptCommand } from "./commands/prompt";
import { reviewCommand } from "./commands/review";
import { reviewDesignCommand } from "./commands/review-design";
import { setupCommand } from "./commands/setup";
import { slopCommand } from "./commands/slop";
import { specCommand } from "./commands/spec";
import { statsCommand } from "./commands/stats";
import { statusCommand } from "./commands/status";
import { syncCommand } from "./commands/sync";
import { teamCommand } from "./commands/team";
import { ticketCommand } from "./commands/ticket";
import { verifyCommand } from "./commands/verify";
import { verifyReceiptCommand } from "./commands/verify-receipt";
import { visualCommand } from "./commands/visual";
import { wikiCommand } from "./commands/wiki/index";

export function createProgram(): Command {
	const program = new Command();
	program
		.name("maina")
		.description(
			`Verification-first developer operating system

Workflow:
  brainstorm    Explore ideas interactively
  ticket        Create GitHub issue from feature
  plan          Scaffold feature directory
  design        Create architecture decision record
  spec          Generate test stubs from spec

Build & Verify:
  verify        Run verification pipeline
  commit        Verify + commit with message
  review        Two-stage code review
  slop          Detect AI slop patterns
  pr            Create pull request

Wiki:
  wiki init     Compile codebase knowledge
  wiki query    Ask about the codebase
  wiki compile  Recompile wiki articles
  wiki status   Wiki health and coverage

Setup & Config:
  init          Bootstrap maina in repo
  setup         Guided first-time setup
  doctor        Check tool and engine health
  login         Cloud authentication
  configure     Edit maina config
  mcp add       Install maina MCP server in supported AI clients
  mcp remove    Uninstall maina MCP server from clients
  mcp list      Show maina MCP install status per client`,
		)
		.version(pkg.version)
		.option(
			"--debug",
			"print full stack traces and error codes on failure (also MAINA_DEBUG=1 or DEBUG=1)",
		);

	// Drain any pending telemetry events at the end of every command so the
	// process doesn't exit with in-flight HTTP requests. Budgeted at 2 s —
	// short enough to keep `maina commit` snappy when the network is dead,
	// long enough for a healthy PostHog ingest to complete (< 300 ms typical).
	program.hook("postAction", async () => {
		try {
			await flushTelemetry(2_000);
		} catch {
			// Telemetry must never block or throw from the exit hook.
		}
	});

	// Belt-and-braces drain for commands that call `process.exit()` directly
	// (login/logout/doctor all do this under certain branches) — Commander's
	// `postAction` hook does not fire in those cases so queued captures
	// would otherwise be dropped. `beforeExit` is Node's last reliable hook
	// before the event loop drains; `SIGINT`/`SIGTERM` cover Ctrl-C and
	// orchestrator kills. `flushTelemetry` is a no-op when no SDK was ever
	// instantiated, so this is free when telemetry is off.
	let exitDrained = false;
	const drain = async (code: number | null): Promise<void> => {
		if (exitDrained) return;
		exitDrained = true;
		try {
			await flushTelemetry(2_000);
		} catch {
			// swallow
		}
		if (code !== null) process.exit(code);
	};
	process.once("beforeExit", () => {
		void drain(null);
	});
	process.once("SIGINT", () => {
		void drain(130);
	});
	process.once("SIGTERM", () => {
		void drain(143);
	});

	// ── Workflow ─────────────────────────────────────────────────────────
	program.addCommand(brainstormCommand());
	program.addCommand(ticketCommand());
	program.addCommand(planCommand());
	program.addCommand(designCommand());
	program.addCommand(specCommand());

	// ── Build & Verify ──────────────────────────────────────────────────
	program.addCommand(verifyCommand());
	program.addCommand(verifyReceiptCommand());
	program.addCommand(commitCommand());
	program.addCommand(reviewCommand());
	program.addCommand(reviewDesignCommand());
	program.addCommand(slopCommand());
	program.addCommand(prCommand());

	// ── Wiki ────────────────────────────────────────────────────────────
	program.addCommand(wikiCommand());

	// ── Setup & Config ──────────────────────────────────────────────────
	program.addCommand(initCommand());
	program.addCommand(setupCommand());
	program.addCommand(doctorCommand());
	program.addCommand(loginCommand());
	program.addCommand(logoutCommand());
	program.addCommand(configureCommand());
	program.addCommand(mcpCommand());

	// ── Internals ───────────────────────────────────────────────────────
	//
	// Wave 4 / G11: these commands are plumbing that the majority of users
	// never type. They stay **registered** (so existing scripts keep
	// working and muscle memory is not broken) but are `.hidden()` from
	// the top-level `maina --help` listing so first-time users see a
	// short, curated command surface. Call them by name to use them.
	const internals = [
		analyzeCommand(),
		benchmarkCommand(),
		cacheCommand(),
		contextCommand(),
		explainCommand(),
		feedbackCommand(),
		learnCommand(),
		promptCommand(),
		statsCommand(),
		statusCommand(),
		syncCommand(),
		teamCommand(),
		visualCommand(),
	];
	for (const cmd of internals) {
		// Commander does not expose a public `.hidden()` method but respects
		// the internal `_hidden` flag when rendering `helpInformation()`.
		// Setting it keeps the command callable while removing it from the
		// top-level help listing — exactly what G11 asks for.
		(cmd as unknown as { _hidden: boolean })._hidden = true;
		program.addCommand(cmd);
	}

	return program;
}
