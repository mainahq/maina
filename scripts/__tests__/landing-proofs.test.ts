/**
 * Landing proofs (#360, FR-DOC-7): every verdict, count and receipt the
 * landing page shows is computed from this repo by the real engines, and the
 * committed files are what those engines produce today.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { LandingProofs } from "../../packages/docs/src/data/landing-proofs";
import { computeLandingProofs, staleLandingProofs } from "../landing-proofs";

const REPO_ROOT = join(import.meta.dir, "..", "..");

let computed: Awaited<ReturnType<typeof computeLandingProofs>>;
let proofs: LandingProofs;

beforeAll(async () => {
	const result = await computeLandingProofs(REPO_ROOT);
	if (!result.ok) throw new Error(result.error);
	computed = result;
	proofs = result.value.proofs;
});

describe("landing proofs", () => {
	test("the committed files match what the engines produce", async () => {
		expect(await staleLandingProofs(REPO_ROOT)).toEqual([]);
	});

	test("the blocked proof is a deny the rules engine reaches on a dogfood case", () => {
		const blocked = proofs.proofs.blocked;
		expect(blocked.verdict).toBe("deny");
		expect(blocked.classes).toContain("gate.self_override");
		expect(blocked.source).toBe(
			"packages/core/src/gate/__fixtures__/commands.jsonl",
		);
		expect(blocked.issue).toBe(447);
	});

	test("the corpus stats count what the rules alone gate", () => {
		const { corpus } = proofs;
		expect(corpus.destructive.total).toBeGreaterThanOrEqual(500);
		expect(corpus.destructive.held).toBeLessThanOrEqual(
			corpus.destructive.total,
		);
		expect(corpus.destructive.held / corpus.destructive.total).toBeGreaterThan(
			0.95,
		);
		expect(corpus.selfOverride.denied).toBe(corpus.selfOverride.total);
	});

	test("the spec proof is an error the analyzer finds in a real feature", () => {
		const spec = proofs.proofs.spec;
		expect(spec.feature).toStartWith(".maina/features/");
		expect(spec.category).toBe("spec-coverage");
		expect(spec.message).toContain("not covered by any task");
	});

	test("the receipt proof is the newest committed receipt", () => {
		const receipt = proofs.proofs.receipt;
		expect(receipt.hash).toMatch(/^[0-9a-f]{64}$/);
		expect(receipt.checks.length).toBe(receipt.total);
		expect(receipt.checks.filter((c) => c.status === "passed").length).toBe(
			receipt.passed,
		);
	});

	test("the try-the-gate lookup table covers the shell corpus", () => {
		expect(computed.ok && computed.value.corpus.length).toBeGreaterThan(900);
	});
});
