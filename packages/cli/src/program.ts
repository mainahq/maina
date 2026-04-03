import { Command } from "commander";
import pkg from "../package.json";
import { cacheCommand } from "./commands/cache";
import { commitCommand } from "./commands/commit";
import { contextCommand } from "./commands/context";
import { doctorCommand } from "./commands/doctor";
import { learnCommand } from "./commands/learn";
import { planCommand } from "./commands/plan";
import { promptCommand } from "./commands/prompt";
import { verifyCommand } from "./commands/verify";

export function createProgram(): Command {
	const program = new Command();
	program
		.name("maina")
		.description("Verification-first developer operating system")
		.version(pkg.version);
	program.addCommand(contextCommand());
	program.addCommand(promptCommand());
	program.addCommand(cacheCommand());
	program.addCommand(learnCommand());
	program.addCommand(commitCommand());
	program.addCommand(planCommand());
	program.addCommand(verifyCommand());
	program.addCommand(doctorCommand());
	return program;
}
