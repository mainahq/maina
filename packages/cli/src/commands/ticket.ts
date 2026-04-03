import { join } from "node:path";
import { intro, isCancel, log, outro, text } from "@clack/prompts";
import {
	createTicket as coreCreateTicket,
	detectModules as coreDetectModules,
} from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TicketActionOptions {
	title?: string;
	body?: string;
	label?: string[];
	cwd?: string;
}

export interface TicketActionResult {
	created: boolean;
	reason?: string;
	url?: string;
}

export interface TicketDeps {
	createTicket: typeof coreCreateTicket;
	detectModules: typeof coreDetectModules;
}

const defaultDeps: TicketDeps = {
	createTicket: coreCreateTicket,
	detectModules: coreDetectModules,
};

// ── Core Action (testable) ───────────────────────────────────────────────────

/**
 * The core ticket logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function ticketAction(
	options: TicketActionOptions,
	deps: TicketDeps = defaultDeps,
): Promise<TicketActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");

	// ── Step 1: Resolve title ────────────────────────────────────────────
	let title = options.title;

	if (!title) {
		const userTitle = await text({
			message: "Issue title:",
			placeholder: "Describe the issue briefly",
			validate: (value) => {
				if (!value || value.trim().length === 0) {
					return "Title is required.";
				}
			},
		});

		if (typeof userTitle === "symbol" || isCancel(userTitle)) {
			return { created: false, reason: "Cancelled by user" };
		}

		title = userTitle;
	}

	// ── Step 2: Resolve body ─────────────────────────────────────────────
	let body = options.body;

	if (!body) {
		const userBody = await text({
			message: "Issue body:",
			placeholder: "Describe the issue in detail",
			validate: (value) => {
				if (!value || value.trim().length === 0) {
					return "Body is required.";
				}
			},
		});

		if (typeof userBody === "symbol" || isCancel(userBody)) {
			return { created: false, reason: "Cancelled by user" };
		}

		body = userBody;
	}

	// ── Step 3: Detect modules for auto-tagging ──────────────────────────
	const autoModules = deps.detectModules(mainaDir, title, body);

	// ── Step 4: Merge auto-detected labels with --label flags ────────────
	const userLabels = options.label ?? [];
	const allLabels = [...new Set([...userLabels, ...autoModules])];

	// ── Step 5: Create the ticket ────────────────────────────────────────
	const result = await deps.createTicket({
		title,
		body,
		labels: allLabels.length > 0 ? allLabels : undefined,
		cwd,
	});

	if (!result.ok) {
		log.error(result.error);
		return { created: false, reason: result.error };
	}

	log.success(`Issue #${result.value.number} created`);
	log.info(result.value.url);

	if (autoModules.length > 0) {
		log.info(`Auto-tagged modules: ${autoModules.join(", ")}`);
	}

	return { created: true, url: result.value.url };
}

// ── Commander Command ────────────────────────────────────────────────────────

export function ticketCommand(): Command {
	return new Command("ticket")
		.description("Create a GitHub Issue with module tagging")
		.option("-t, --title <title>", "Issue title")
		.option("-b, --body <body>", "Issue body")
		.option("-l, --label <label...>", "Additional labels")
		.action(async (options) => {
			intro("maina ticket");

			const result = await ticketAction({
				title: options.title,
				body: options.body,
				label: options.label,
			});

			if (result.created) {
				outro(`Created: ${result.url}`);
			} else {
				outro(`Aborted: ${result.reason}`);
			}
		});
}
