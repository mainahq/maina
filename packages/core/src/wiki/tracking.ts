/**
 * Wiki Reference Tracking — records which wiki articles are read/written
 * during workflow commands.
 *
 * Wraps appendWikiRefs from workflow/context to provide a wiki-specific API.
 */

import { appendWikiRefs } from "../workflow/context";

/**
 * Track wiki articles that were read during a command.
 */
export function trackWikiRefsRead(
	mainaDir: string,
	command: string,
	articles: string[],
): void {
	appendWikiRefs(mainaDir, command, articles, []);
}

/**
 * Track wiki articles that were written during a command.
 */
export function trackWikiRefsWritten(
	mainaDir: string,
	command: string,
	articles: string[],
): void {
	appendWikiRefs(mainaDir, command, [], articles);
}
