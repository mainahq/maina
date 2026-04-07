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
import { initCommand } from "./commands/init";
import { learnCommand } from "./commands/learn";
import { loginCommand, logoutCommand } from "./commands/login";
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
  configure     Edit maina config`,
		)
		.version(pkg.version);

	// ── Workflow ─────────────────────────────────────────────────────────
	program.addCommand(brainstormCommand());
	program.addCommand(ticketCommand());
	program.addCommand(planCommand());
	program.addCommand(designCommand());
	program.addCommand(specCommand());

	// ── Build & Verify ──────────────────────────────────────────────────
	program.addCommand(verifyCommand());
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

	// ── Internals ───────────────────────────────────────────────────────
	program.addCommand(analyzeCommand());
	program.addCommand(benchmarkCommand());
	program.addCommand(cacheCommand());
	program.addCommand(contextCommand());
	program.addCommand(explainCommand());
	program.addCommand(learnCommand());
	program.addCommand(promptCommand());
	program.addCommand(statsCommand());
	program.addCommand(statusCommand());
	program.addCommand(syncCommand());
	program.addCommand(teamCommand());
	program.addCommand(visualCommand());

	return program;
}
