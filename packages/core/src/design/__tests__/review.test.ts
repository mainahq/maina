import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewContext } from "../review";
import { buildReviewContext, reviewDesign } from "../review";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-review-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// ── Sample ADRs ─────────────────────────────────────────────────────────────

const COMPLETE_ADR = `# 0001. Use Bun Runtime

Date: 2026-01-01

## Status

Accepted

## Context

We need a fast JavaScript runtime for our CLI tool.

## Decision

We will use Bun as our JavaScript runtime.

## Consequences

### Positive

- Fast startup time
- Built-in test runner

### Negative

- Smaller ecosystem than Node.js
`;

const MISSING_STATUS_ADR = `# 0002. Use Biome

Date: 2026-01-02

## Context

We need a linter and formatter.

## Decision

We will use Biome.

## Consequences

### Positive

- Fast
`;

const MISSING_DECISION_ADR = `# 0003. Choose Database

Date: 2026-01-03

## Status

Proposed

## Context

We need a database for caching.

## Consequences

### Positive

- Persistence
`;

const ADR_WITH_CLARIFICATION = `# 0004. API Design

Date: 2026-01-04

## Status

Proposed

## Context

We need to design the API surface.

[NEEDS CLARIFICATION] What protocols to support?

## Decision

Use REST for now.

## Consequences

### Positive

- Simple to implement
`;

const CONSTITUTION = `# Constitution

## Core Principles

- Always use TypeScript strict mode
- TDD always
- Never throw, use Result<T, E>
`;

// ── buildReviewContext ───────────────────────────────────────────────────────

describe("buildReviewContext", () => {
	let tmpDir: string;
	let adrDir: string;
	let mainaDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		adrDir = join(tmpDir, "adr");
		mainaDir = join(tmpDir, ".maina");
		mkdirSync(adrDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("reads target ADR correctly", async () => {
		const adrPath = join(adrDir, "0001-use-bun-runtime.md");
		await Bun.write(adrPath, COMPLETE_ADR);

		const result = await buildReviewContext(adrPath, adrDir, mainaDir);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.targetAdr.path).toBe(adrPath);
			expect(result.value.targetAdr.content).toBe(COMPLETE_ADR);
			expect(result.value.targetAdr.title).toBe("Use Bun Runtime");
		}
	});

	test("includes existing ADRs (excluding target)", async () => {
		const targetPath = join(adrDir, "0001-use-bun-runtime.md");
		await Bun.write(targetPath, COMPLETE_ADR);
		await Bun.write(join(adrDir, "0002-use-biome.md"), MISSING_STATUS_ADR);
		await Bun.write(
			join(adrDir, "0003-choose-database.md"),
			MISSING_DECISION_ADR,
		);

		const result = await buildReviewContext(targetPath, adrDir, mainaDir);

		expect(result.ok).toBe(true);
		if (result.ok) {
			// Should not include the target ADR in existing list
			expect(result.value.existingAdrs.length).toBe(2);
			const paths = result.value.existingAdrs.map((a) => a.path);
			expect(paths).not.toContain(targetPath);
		}
	});

	test("includes constitution when present", async () => {
		const adrPath = join(adrDir, "0001-use-bun-runtime.md");
		await Bun.write(adrPath, COMPLETE_ADR);
		mkdirSync(mainaDir, { recursive: true });
		await Bun.write(join(mainaDir, "constitution.md"), CONSTITUTION);

		const result = await buildReviewContext(adrPath, adrDir, mainaDir);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.constitution).toBe(CONSTITUTION);
		}
	});

	test("handles missing constitution gracefully", async () => {
		const adrPath = join(adrDir, "0001-use-bun-runtime.md");
		await Bun.write(adrPath, COMPLETE_ADR);

		const result = await buildReviewContext(adrPath, adrDir, mainaDir);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.constitution).toBeNull();
		}
	});

	test("returns error for missing target ADR", async () => {
		const adrPath = join(adrDir, "0099-nonexistent.md");

		const result = await buildReviewContext(adrPath, adrDir, mainaDir);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("not found");
		}
	});
});

// ── reviewDesign ────────────────────────────────────────────────────────────

describe("reviewDesign", () => {
	test("complete ADR has no errors", () => {
		const context = {
			targetAdr: {
				path: "adr/0001-use-bun-runtime.md",
				content: COMPLETE_ADR,
				title: "Use Bun Runtime",
			},
			existingAdrs: [],
			constitution: null,
		};

		const result = reviewDesign(context);

		expect(result.ok).toBe(true);
		if (result.ok) {
			const errors = result.value.findings.filter(
				(f) => f.severity === "error",
			);
			expect(errors.length).toBe(0);
			expect(result.value.passed).toBe(true);
		}
	});

	test("missing ## Status section produces error", () => {
		const context = {
			targetAdr: {
				path: "adr/0002-use-biome.md",
				content: MISSING_STATUS_ADR,
				title: "Use Biome",
			},
			existingAdrs: [],
			constitution: null,
		};

		const result = reviewDesign(context);

		expect(result.ok).toBe(true);
		if (result.ok) {
			const errors = result.value.findings.filter(
				(f) => f.severity === "error",
			);
			expect(errors.length).toBeGreaterThan(0);
			const statusError = errors.find((f) => f.section === "Status");
			expect(statusError).toBeDefined();
			expect(result.value.passed).toBe(false);
		}
	});

	test("missing ## Decision section produces error", () => {
		const context = {
			targetAdr: {
				path: "adr/0003-choose-database.md",
				content: MISSING_DECISION_ADR,
				title: "Choose Database",
			},
			existingAdrs: [],
			constitution: null,
		};

		const result = reviewDesign(context);

		expect(result.ok).toBe(true);
		if (result.ok) {
			const errors = result.value.findings.filter(
				(f) => f.severity === "error",
			);
			const decisionError = errors.find((f) => f.section === "Decision");
			expect(decisionError).toBeDefined();
			expect(result.value.passed).toBe(false);
		}
	});

	test("contains [NEEDS CLARIFICATION] produces warning", () => {
		const context = {
			targetAdr: {
				path: "adr/0004-api-design.md",
				content: ADR_WITH_CLARIFICATION,
				title: "API Design",
			},
			existingAdrs: [],
			constitution: null,
		};

		const result = reviewDesign(context);

		expect(result.ok).toBe(true);
		if (result.ok) {
			const warnings = result.value.findings.filter(
				(f) => f.severity === "warning",
			);
			expect(warnings.length).toBeGreaterThan(0);
			const clarificationWarning = warnings.find((f) =>
				f.message.includes("NEEDS CLARIFICATION"),
			);
			expect(clarificationWarning).toBeDefined();
		}
	});

	test("all MADR sections present lists them in sectionsPresent", () => {
		const context = {
			targetAdr: {
				path: "adr/0001-use-bun-runtime.md",
				content: COMPLETE_ADR,
				title: "Use Bun Runtime",
			},
			existingAdrs: [],
			constitution: null,
		};

		const result = reviewDesign(context);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.sectionsPresent).toContain("Status");
			expect(result.value.sectionsPresent).toContain("Context");
			expect(result.value.sectionsPresent).toContain("Decision");
			expect(result.value.sectionsPresent).toContain("Consequences");
			expect(result.value.sectionsMissing.length).toBe(0);
		}
	});

	test("passed is true when no errors", () => {
		const context = {
			targetAdr: {
				path: "adr/0001-use-bun-runtime.md",
				content: COMPLETE_ADR,
				title: "Use Bun Runtime",
			},
			existingAdrs: [],
			constitution: null,
		};

		const result = reviewDesign(context);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.passed).toBe(true);
		}
	});

	test("sectionsMissing lists missing sections", () => {
		const context = {
			targetAdr: {
				path: "adr/0002-use-biome.md",
				content: MISSING_STATUS_ADR,
				title: "Use Biome",
			},
			existingAdrs: [],
			constitution: null,
		};

		const result = reviewDesign(context);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.sectionsMissing).toContain("Status");
			expect(result.value.sectionsPresent).toContain("Context");
			expect(result.value.sectionsPresent).toContain("Decision");
			expect(result.value.sectionsPresent).toContain("Consequences");
		}
	});

	test("adrPath is set in result", () => {
		const context = {
			targetAdr: {
				path: "adr/0001-use-bun-runtime.md",
				content: COMPLETE_ADR,
				title: "Use Bun Runtime",
			},
			existingAdrs: [],
			constitution: null,
		};

		const result = reviewDesign(context);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.adrPath).toBe("adr/0001-use-bun-runtime.md");
		}
	});
});

// ── reviewDesign HLD/LLD validation ─────────────────────────────────────────

describe("reviewDesign HLD/LLD validation", () => {
	function makeContext(content: string): ReviewContext {
		return {
			targetAdr: { path: "/test/0001-test.md", content, title: "Test" },
			existingAdrs: [],
			constitution: null,
		};
	}

	test("should warn when HLD sections are missing", () => {
		const content = `# 0001. Test

## Status
Proposed

## Context
Some context.

## Decision
Some decision.

## Consequences
Some consequences.
`;

		const result = reviewDesign(makeContext(content));
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const hldWarning = result.value.findings.find((f) =>
			f.message.includes("High-Level Design"),
		);
		expect(hldWarning).toBeDefined();
		expect(hldWarning?.severity).toBe("warning");
	});

	test("should warn when LLD sections are missing", () => {
		const content = `# 0001. Test

## Status
Proposed

## Context
Some context.

## Decision
Some decision.

## Consequences
Some consequences.

## High-Level Design
### System Overview
Overview here.
### Component Boundaries
Components here.
### Data Flow
Flow here.
### External Dependencies
None.
`;

		const result = reviewDesign(makeContext(content));
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const lldWarning = result.value.findings.find((f) =>
			f.message.includes("Low-Level Design"),
		);
		expect(lldWarning).toBeDefined();
	});

	test("should not warn when all HLD/LLD sections are present", () => {
		const content = `# 0001. Test

## Status
Proposed

## Context
Some context.

## Decision
Some decision.

## Consequences
Some consequences.

## High-Level Design
### System Overview
Overview.
### Component Boundaries
Components.
### Data Flow
Flow.
### External Dependencies
None.

## Low-Level Design
### Interfaces & Types
Types.
### Function Signatures
Signatures.
### DB Schema Changes
None.
### Sequence of Operations
Steps.
### Error Handling
Errors.
### Edge Cases
Edges.
`;

		const result = reviewDesign(makeContext(content));
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const designWarnings = result.value.findings.filter(
			(f) =>
				f.message.includes("High-Level Design") ||
				f.message.includes("Low-Level Design"),
		);
		expect(designWarnings).toHaveLength(0);
	});
});
