import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import {
	appendWorkflowStep,
	buildReviewContext as coreBuildReviewContext,
	findAdrByNumber as coreFindAdrByNumber,
	reviewDesign as coreReviewDesign,
	getCurrentBranch,
	getWorkflowId,
	recordFeedbackAsync,
} from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReviewDesignActionOptions {
	adr: string;
	cwd?: string;
}

export interface ReviewDesignActionResult {
	reviewed: boolean;
	passed?: boolean;
	reason?: string;
	findings?: Array<{
		severity: "error" | "warning" | "info";
		message: string;
		section?: string;
	}>;
}

export interface ReviewDesignDeps {
	buildReviewContext: typeof coreBuildReviewContext;
	reviewDesign: typeof coreReviewDesign;
	findAdrByNumber: typeof coreFindAdrByNumber;
}

// ── Default Dependencies ────────────────────────────────────────────────────

const defaultDeps: ReviewDesignDeps = {
	buildReviewContext: coreBuildReviewContext,
	reviewDesign: coreReviewDesign,
	findAdrByNumber: coreFindAdrByNumber,
};

// ── Core Action (testable) ──────────────────────────────────────────────────

/**
 * The core review-design logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function reviewDesignAction(
	options: ReviewDesignActionOptions,
	deps: ReviewDesignDeps = defaultDeps,
): Promise<ReviewDesignActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const adrDir = join(cwd, "adr");
	const mainaDir = join(cwd, ".maina");
	const adrInput = options.adr;

	// ── Resolve ADR path ──────────────────────────────────────────────────
	let adrPath: string;

	// Check if input looks like a path (contains / or \ or ends with .md)
	const looksLikePath =
		adrInput.includes("/") ||
		adrInput.includes("\\") ||
		adrInput.endsWith(".md");

	if (looksLikePath) {
		// Treat as file path
		adrPath = isAbsolute(adrInput) ? adrInput : join(cwd, adrInput);

		if (!existsSync(adrPath)) {
			log.error(`ADR file not found: ${adrPath}`);
			return { reviewed: false, reason: `ADR file not found: ${adrPath}` };
		}
	} else {
		// Treat as ADR number
		const findResult = await deps.findAdrByNumber(adrDir, adrInput);
		if (!findResult.ok) {
			log.error(findResult.error);
			return { reviewed: false, reason: findResult.error };
		}
		adrPath = findResult.value;
	}

	// ── Build context ─────────────────────────────────────────────────────
	const contextResult = await deps.buildReviewContext(
		adrPath,
		adrDir,
		mainaDir,
	);
	if (!contextResult.ok) {
		log.error(contextResult.error);
		return { reviewed: false, reason: contextResult.error };
	}

	// ── Run review ────────────────────────────────────────────────────────
	const reviewResult = deps.reviewDesign(contextResult.value);
	if (!reviewResult.ok) {
		log.error(reviewResult.error);
		return { reviewed: false, reason: reviewResult.error };
	}

	const { findings, passed, sectionsPresent, sectionsMissing } =
		reviewResult.value;

	// ── Display results ───────────────────────────────────────────────────
	log.info(`Reviewing: ${contextResult.value.targetAdr.title}`);

	if (sectionsPresent.length > 0) {
		for (const section of sectionsPresent) {
			log.success(`  [present] ## ${section}`);
		}
	}

	if (sectionsMissing.length > 0) {
		for (const section of sectionsMissing) {
			log.error(`  [missing] ## ${section}`);
		}
	}

	for (const finding of findings) {
		switch (finding.severity) {
			case "error":
				log.error(`  ${finding.message}`);
				break;
			case "warning":
				log.warning(`  ${finding.message}`);
				break;
			case "info":
				log.info(`  ${finding.message}`);
				break;
		}
	}

	appendWorkflowStep(
		mainaDir,
		"design-review",
		`ADR reviewed: ${passed ? "passed" : "failed"}. ${findings.length} finding(s).`,
	);

	const branch = await getCurrentBranch(cwd);
	const workflowId = getWorkflowId(branch);
	recordFeedbackAsync(mainaDir, {
		promptHash: "deterministic",
		task: "review-design",
		accepted: passed,
		timestamp: new Date().toISOString(),
		workflowStep: "design-review",
		workflowId,
	});

	return {
		reviewed: true,
		passed,
		findings,
	};
}

// ── Commander Command ───────────────────────────────────────────────────────

export function reviewDesignCommand(): Command {
	return new Command("review-design")
		.description("Review an ADR against existing decisions and constitution")
		.argument("<adr>", "ADR number (e.g., 0001) or file path")
		.action(async (adr) => {
			intro("maina review-design");

			const result = await reviewDesignAction({ adr });

			if (!result.reviewed) {
				outro(`Aborted: ${result.reason}`);
				return;
			}

			if (result.passed) {
				outro("Review passed — ADR looks good.");
			} else {
				outro("Review failed — see findings above.");
			}
		});
}
