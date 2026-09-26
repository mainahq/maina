import { describe, expect, test } from "bun:test";
import { artifactRef, checkArtifact, hashArtifact } from "../ref";

const PLAN = "# Plan\n\n1. Write the failing test.\n";

describe("hashArtifact", () => {
	test("is sha256:<64 hex> and stable", () => {
		const hash = hashArtifact(PLAN);
		expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(hashArtifact(PLAN)).toBe(hash);
		expect(hashArtifact(`${PLAN} `)).not.toBe(hash);
	});
});

describe("artifactRef", () => {
	test("pairs an id with a hash", () => {
		const hash = hashArtifact(PLAN);
		expect(artifactRef("plan-321", hash)).toEqual({
			ok: true,
			value: { id: "plan-321", hash },
		});
	});

	test("rejects ids that could leave the artifact store", () => {
		const hash = hashArtifact(PLAN);
		for (const id of ["", "../secrets", "a/b", "a\\b", ".hidden", ".."]) {
			const ref = artifactRef(id, hash);
			expect(ref.ok).toBe(false);
			if (!ref.ok) expect(ref.error.kind).toBe("invalid_id");
		}
	});

	test("rejects a hash that is not sha256:<64 hex>", () => {
		for (const hash of ["", "abc", "sha256:xyz", `md5:${"0".repeat(32)}`]) {
			const ref = artifactRef("plan", hash);
			expect(ref.ok).toBe(false);
			if (!ref.ok) expect(ref.error.kind).toBe("invalid_hash");
		}
	});
});

describe("checkArtifact", () => {
	test("returns the content when its hash matches the ref", () => {
		const ref = { id: "plan", hash: hashArtifact(PLAN) };
		expect(checkArtifact(ref, PLAN)).toEqual({ ok: true, value: PLAN });
	});

	test("rejects content whose hash differs from the ref", () => {
		const ref = { id: "plan", hash: hashArtifact(PLAN) };
		const checked = checkArtifact(ref, `${PLAN}tampered\n`);
		expect(checked).toEqual({
			ok: false,
			error: {
				kind: "hash_mismatch",
				id: "plan",
				expected: ref.hash,
				actual: hashArtifact(`${PLAN}tampered\n`),
			},
		});
	});
});
