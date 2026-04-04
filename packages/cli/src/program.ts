import { Command } from "commander";
import pkg from "../package.json";
import { analyzeCommand } from "./commands/analyze";
import { benchmarkCommand } from "./commands/benchmark";
import { cacheCommand } from "./commands/cache";
import { commitCommand } from "./commands/commit";
import { configureCommand } from "./commands/configure";
import { contextCommand } from "./commands/context";
import { designCommand } from "./commands/design";
import { doctorCommand } from "./commands/doctor";
import { explainCommand } from "./commands/explain";
import { initCommand } from "./commands/init";
import { learnCommand } from "./commands/learn";
import { planCommand } from "./commands/plan";
import { prCommand } from "./commands/pr";
import { promptCommand } from "./commands/prompt";
import { reviewCommand } from "./commands/review";
import { reviewDesignCommand } from "./commands/review-design";
import { slopCommand } from "./commands/slop";
import { specCommand } from "./commands/spec";
import { statsCommand } from "./commands/stats";
import { statusCommand } from "./commands/status";
import { ticketCommand } from "./commands/ticket";
import { verifyCommand } from "./commands/verify";
import { visualCommand } from "./commands/visual";

export function createProgram(): Command {
	const program = new Command();
	program
		.name("maina")
		.description("Verification-first developer operating system")
		.version(pkg.version);
	program.addCommand(analyzeCommand());
	program.addCommand(benchmarkCommand());
	program.addCommand(configureCommand());
	program.addCommand(contextCommand());
	program.addCommand(promptCommand());
	program.addCommand(cacheCommand());
	program.addCommand(learnCommand());
	program.addCommand(commitCommand());
	program.addCommand(planCommand());
	program.addCommand(specCommand());
	program.addCommand(statsCommand());
	program.addCommand(verifyCommand());
	program.addCommand(ticketCommand());
	program.addCommand(designCommand());
	program.addCommand(doctorCommand());
	program.addCommand(explainCommand());
	program.addCommand(initCommand());
	program.addCommand(prCommand());
	program.addCommand(reviewCommand());
	program.addCommand(reviewDesignCommand());
	program.addCommand(slopCommand());
	program.addCommand(statusCommand());
	program.addCommand(visualCommand());
	return program;
}
