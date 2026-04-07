/**
 * Wiki subcommand registration — `maina wiki <subcommand>`.
 *
 * Groups init, compile, query, and status under the wiki parent command.
 */

import { Command } from "commander";
import { wikiCompileCommand } from "./compile";
import { wikiInitCommand } from "./init";
import { wikiQueryCommand } from "./query";
import { wikiStatusCommand } from "./status";

export function wikiCommand(): Command {
	const wiki = new Command("wiki").description("Codebase knowledge wiki");

	wikiInitCommand(wiki);
	wikiCompileCommand(wiki);
	wikiQueryCommand(wiki);
	wikiStatusCommand(wiki);

	return wiki;
}
