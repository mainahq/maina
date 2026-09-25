/**
 * The analyzer reads Spec Kit artifacts as feature input (FR-SPEC-7): a
 * Spec Kit tasks.md spreads its tasks over `## Phase N: …` sections and
 * writes them as `- [ ] T001 [P] [US1] Description`, with no colon after
 * the id.
 */

import { describe, expect, test } from "bun:test";
import { analyzeArtifacts } from "../analyzer";

const SPEC = `# Feature Specification: Photo Albums

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create albums (Priority: P1)

Users group their photos into albums.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST let users create photo albums
- **FR-002**: Users MUST be able to add photos to an album
`;

const PLAN = `# Implementation Plan: Photo Albums

## Summary

Albums are stored per user.
`;

const TASKS = `# Tasks: Photo Albums

**Input**: Design documents from \`/specs/001-photo-albums/\`

## Format: \`[ID] [P?] [Story] Description\`

- **[P]**: Can run in parallel (different files, no dependencies)

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Create photo albums project structure

## Phase 3: User Story 1 - Create albums (Priority: P1) 🎯 MVP

### Implementation for User Story 1

- [ ] T002 [P] [US1] Create album model for photo albums
- [ ] T003 [US1] Add photos to an album
- [ ] T004 [P] Configure kubernetes helm charts for billing invoices

## Dependencies & Execution Order

- Setup has no dependencies
`;

describe("analyzeArtifacts on Spec Kit artifacts", () => {
	test("counts the tasks of every Phase section, and nothing outside them", () => {
		const report = analyzeArtifacts(SPEC, PLAN, TASKS);
		const consistency = report.findings.find(
			(f) => f.category === "task-consistency",
		);
		expect(consistency?.message).toContain("tasks.md has 4 tasks");
	});

	test("judges Spec Kit tasks against the spec: an unrelated task is orphaned", () => {
		const report = analyzeArtifacts(SPEC, PLAN, TASKS);
		const orphans = report.findings
			.filter((f) => f.category === "orphaned-task")
			.map((f) => f.message);
		expect(orphans.some((m) => m.includes("T004"))).toBe(true);
		expect(orphans.some((m) => m.includes("T003"))).toBe(false);
	});
});
