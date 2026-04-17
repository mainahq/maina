/**
 * Slash Command Parser — extracts `/maina <cmd>` from PR comment text.
 *
 * Pure function: text → SlashCommand | null.
 * No GitHub API calls, no side effects.
 */

// ── Types ──────────────────────────────────────────────────────────────

export type SlashCommandType = "retry" | "explain" | "approve";

export interface SlashCommand {
	command: SlashCommandType;
	args: string;
	raw: string;
}

export interface CommentAuthor {
	login: string;
	isPrAuthor: boolean;
	hasWritePermission: boolean;
}

// ── Parser ─────────────────────────────────────────────────────────────

const VALID_COMMANDS = new Set<string>(["retry", "explain", "approve"]);

const COMMAND_PATTERN = /^\s*\/maina\s+(\w+)(?:\s+(.*))?$/im;

/**
 * Parse a `/maina <command> [args]` from comment text.
 * Returns null if the comment doesn't contain a valid slash command.
 *
 * Handles:
 * - Extra whitespace
 * - Case insensitive command matching
 * - Commands embedded in multi-line comments (first match wins)
 * - `/maina` with no subcommand → null
 */
export function parseSlashCommand(text: string): SlashCommand | null {
	const match = text.match(COMMAND_PATTERN);
	if (!match?.[1]) return null;

	const command = match[1].toLowerCase();
	if (!VALID_COMMANDS.has(command)) return null;

	return {
		command: command as SlashCommandType,
		args: (match[2] ?? "").trim(),
		raw: match[0].trim(),
	};
}

// ── ACL ────────────────────────────────────────────────────────────────

/**
 * Check if the comment author is authorized to run slash commands.
 * Authorized: PR author OR repo write permission.
 */
export function isAuthorized(author: CommentAuthor): boolean {
	return author.isPrAuthor || author.hasWritePermission;
}
