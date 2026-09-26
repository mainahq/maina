import { describe, expect, test } from "bun:test";
import { createMemoryFs } from "../../ports/testing";
import { hashArtifact } from "../ref";
import { artifactPath, getArtifact, putArtifact } from "../store";

const ROOT = "/repo";
const LOG = "verify output\n".repeat(200);

describe("artifact store: evidence passes by id + hash (FR-FAC-6)", () => {
	test("put returns a ref (id + hash), not the content", async () => {
		const fs = createMemoryFs();
		const put = await putArtifact(fs, ROOT, "verify-log", LOG);
		expect(put).toEqual({
			ok: true,
			value: { id: "verify-log", hash: hashArtifact(LOG) },
		});
		expect(await fs.readFile(artifactPath(ROOT, "verify-log"))).toEqual({
			ok: true,
			value: LOG,
		});
	});

	test("get by ref returns the content after checking its hash", async () => {
		const fs = createMemoryFs();
		const put = await putArtifact(fs, ROOT, "verify-log", LOG);
		if (!put.ok) throw new Error("put failed");
		expect(await getArtifact(fs, ROOT, put.value)).toEqual({
			ok: true,
			value: LOG,
		});
	});

	test("get refuses an artifact changed after its ref was taken", async () => {
		const fs = createMemoryFs();
		const put = await putArtifact(fs, ROOT, "verify-log", LOG);
		if (!put.ok) throw new Error("put failed");
		await fs.writeFile(artifactPath(ROOT, "verify-log"), "all green\n");
		const got = await getArtifact(fs, ROOT, put.value);
		expect(got.ok).toBe(false);
		if (!got.ok) expect(got.error.kind).toBe("hash_mismatch");
	});

	test("get of a missing artifact is not_found", async () => {
		const got = await getArtifact(createMemoryFs(), ROOT, {
			id: "nope",
			hash: hashArtifact("x"),
		});
		expect(got).toEqual({
			ok: false,
			error: { kind: "not_found", id: "nope" },
		});
	});

	test("get validates the ref before touching the filesystem", async () => {
		const got = await getArtifact(createMemoryFs(), ROOT, {
			id: "../../etc/passwd",
			hash: hashArtifact("x"),
		});
		expect(got.ok).toBe(false);
		if (!got.ok) expect(got.error.kind).toBe("invalid_id");
	});

	test("artifacts are immutable: putting new content under an id is a conflict", async () => {
		const fs = createMemoryFs();
		await putArtifact(fs, ROOT, "plan", "v1");
		expect((await putArtifact(fs, ROOT, "plan", "v1")).ok).toBe(true);
		const again = await putArtifact(fs, ROOT, "plan", "v2");
		expect(again.ok).toBe(false);
		if (!again.ok) expect(again.error.kind).toBe("conflict");
		expect(await fs.readFile(artifactPath(ROOT, "plan"))).toEqual({
			ok: true,
			value: "v1",
		});
	});
});
