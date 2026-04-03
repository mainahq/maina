import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { intro, isCancel, log, outro, select, text } from "@clack/prompts";
import {
	getNextAdrNumber as coreGetNextAdrNumber,
	listAdrs as coreListAdrs,
	scaffoldAdr as coreScaffoldAdr,
	type DesignApproach,
	generateDesignApproaches,
} from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DesignActionOptions {
	title?: string;
	list?: boolean;
	cwd?: string;
	noInteractive?: boolean;
}

export interface DesignActionResult {
	created: boolean;
	listed?: boolean;
	reason?: string;
	adrNumber?: string;
	path?: string;
	approachSelected?: string;
}

export interface DesignDeps {
	getNextAdrNumber: typeof coreGetNextAdrNumber;
	scaffoldAdr: typeof coreScaffoldAdr;
	listAdrs: typeof coreListAdrs;
	openInEditor: (filePath: string, cwd: string) => Promise<void>;
}

// ── Editor Helper ───────────────────────────────────────────────────────────

async function openInEditor(filePath: string, cwd: string): Promise<void> {
	const editor = process.env.EDITOR;
	if (!editor) return;

	try {
		const proc = Bun.spawn([editor, filePath], {
			cwd,
			stdout: "inherit",
			stderr: "inherit",
			stdin: "inherit",
		});
		await proc.exited;
	} catch {
		// Editor launch failed — not critical
	}
}

const defaultDeps: DesignDeps = {
	getNextAdrNumber: coreGetNextAdrNumber,
	scaffoldAdr: coreScaffoldAdr,
	listAdrs: coreListAdrs,
	openInEditor,
};

// ── Core Action (testable) ───────────────────────────────────────────────────

/**
 * The core design logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function designAction(
	options: DesignActionOptions,
	deps: DesignDeps = defaultDeps,
): Promise<DesignActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const adrDir = join(cwd, "adr");

	// ── List mode ────────────────────────────────────────────────────────
	if (options.list) {
		const listResult = await deps.listAdrs(adrDir);

		if (!listResult.ok) {
			log.error(listResult.error);
			return { created: false, listed: false, reason: listResult.error };
		}

		if (listResult.value.length === 0) {
			log.info("No ADRs found.");
		} else {
			for (const adr of listResult.value) {
				log.info(`${adr.number}. ${adr.title} [${adr.status}]`);
			}
		}

		return { created: false, listed: true };
	}

	// ── Create mode ──────────────────────────────────────────────────────

	// Step 1: Get next ADR number
	const numberResult = await deps.getNextAdrNumber(adrDir);

	if (!numberResult.ok) {
		log.error(`Failed to get ADR number: ${numberResult.error}`);
		return {
			created: false,
			reason: numberResult.error,
		};
	}

	const adrNumber = numberResult.value;

	// Step 2: Resolve title
	let title = options.title;

	if (!title) {
		const userTitle = await text({
			message: "ADR title:",
			placeholder: "Describe the architectural decision",
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

	// Step 3: Scaffold the ADR
	const scaffoldResult = await deps.scaffoldAdr(adrDir, adrNumber, title);

	if (!scaffoldResult.ok) {
		log.error(`Failed to scaffold ADR: ${scaffoldResult.error}`);
		return {
			created: false,
			reason: scaffoldResult.error,
		};
	}

	const filePath = scaffoldResult.value;

	log.success(`ADR ${adrNumber} created: ${filePath}`);

	// Step 4: Interactive approach proposals
	let approachSelected: string | undefined;

	if (!options.noInteractive && title) {
		const mainaDir = join(cwd, ".maina");
		const approachesResult = await generateDesignApproaches(
			`ADR: ${title}`,
			mainaDir,
		);

		if (approachesResult.ok && approachesResult.value.length > 0) {
			const selected = await proposeApproaches(approachesResult.value);
			if (selected) {
				appendAlternativesConsidered(
					filePath,
					approachesResult.value,
					selected,
				);
				approachSelected = selected;
			}
		}
	}

	// Step 5: Open in $EDITOR if available
	await deps.openInEditor(filePath, cwd);

	return {
		created: true,
		adrNumber,
		path: filePath,
		approachSelected,
	};
}

// ── Interactive Approach Helpers ─────────────────────────────────────────────

async function proposeApproaches(
	approaches: DesignApproach[],
): Promise<string | null> {
	const recommended = approaches.find((a) => a.recommended);

	const selected = await select({
		message: `Choose an approach${recommended ? ` (recommended: ${recommended.name})` : ""}:`,
		options: approaches.map((a) => ({
			value: a.name,
			label: `${a.name}${a.recommended ? " (recommended)" : ""}`,
			hint: a.description,
		})),
	});

	if (isCancel(selected)) {
		return null;
	}

	return selected as string;
}

function appendAlternativesConsidered(
	adrPath: string,
	approaches: DesignApproach[],
	selectedName: string,
): void {
	if (!existsSync(adrPath)) return;

	let section = "\n\n## Alternatives Considered\n\n";
	section +=
		"| Approach | Pros | Cons | Selected |\n|----------|------|------|----------|\n";

	for (const a of approaches) {
		const isSelected = a.name === selectedName ? "**Yes**" : "No";
		section += `| ${a.name} | ${a.pros.join(", ")} | ${a.cons.join(", ")} | ${isSelected} |\n`;
	}

	appendFileSync(adrPath, section);
}

// ── Commander Command ────────────────────────────────────────────────────────

export function designCommand(): Command {
	return new Command("design")
		.description("Create an Architecture Decision Record")
		.option("-t, --title <title>", "ADR title")
		.option("--list", "List existing ADRs")
		.option("--no-interactive", "Skip approach proposals phase")
		.action(async (options) => {
			intro("maina design");

			const result = await designAction({
				title: options.title,
				list: options.list,
				noInteractive: options.interactive === false,
			});

			if (result.listed) {
				outro("Done.");
			} else if (result.created) {
				if (result.approachSelected) {
					log.info(`Approach selected: ${result.approachSelected}`);
				}
				outro(`ADR ${result.adrNumber} ready — edit the file, then review.`);
			} else {
				outro(`Aborted: ${result.reason}`);
			}
		});
}
