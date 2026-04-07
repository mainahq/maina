/**
 * Wiki subcommand registration — `maina wiki <subcommand>`.
 *
 * Groups init, compile, query, status, ingest, and lint under the wiki parent command.
 */

import { Command } from "commander";
import { wikiCompileCommand } from "./compile";
import { wikiIngestCommand } from "./ingest";
import { wikiInitCommand } from "./init";
import { wikiLintCommand } from "./lint";
import { wikiQueryCommand } from "./query";
import { wikiStatusCommand } from "./status";

export function wikiCommand(): Command {
	const wiki = new Command("wiki").description("Codebase knowledge wiki");

	wikiInitCommand(wiki);
	wikiCompileCommand(wiki);
	wikiQueryCommand(wiki);
	wikiStatusCommand(wiki);
	wikiIngestCommand(wiki);
	wikiLintCommand(wiki);

	return wiki;
}
