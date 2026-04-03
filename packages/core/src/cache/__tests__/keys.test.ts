import { describe, expect, it } from "bun:test";
import { buildCacheKey, hashContent, hashFile, hashFiles } from "../keys";

describe("hashContent", () => {
	it("returns a consistent hex string", () => {
		const result = hashContent("hello");
		expect(typeof result).toBe("string");
		expect(result).toMatch(/^[0-9a-f]{64}$/);
	});

	it("returns the same hash for the same input", () => {
		expect(hashContent("hello")).toBe(hashContent("hello"));
	});

	it("returns different hashes for different inputs", () => {
		expect(hashContent("hello")).not.toBe(hashContent("world"));
	});
});

describe("hashFile", () => {
	it("returns a hash for an existing file", async () => {
		// Use this test file itself as the existing file
		const result = await hashFile(import.meta.path);
		expect(typeof result).toBe("string");
		expect(result).toMatch(/^[0-9a-f]{64}$/);
		expect(result.length).toBeGreaterThan(0);
	});

	it("returns empty string for a non-existent file", async () => {
		const result = await hashFile("/this/path/does/not/exist/at/all.ts");
		expect(result).toBe("");
	});
});

describe("hashFiles", () => {
	it("returns a string hash for a list of files", async () => {
		const result = await hashFiles([import.meta.path]);
		expect(typeof result).toBe("string");
		expect(result).toMatch(/^[0-9a-f]{64}$/);
	});

	it("is order-independent (sorted internally)", async () => {
		const thisFile = import.meta.path;
		// Use two real files that exist in the repo
		const otherFile = import.meta.path.replace("keys.test.ts", "ttl.test.ts");
		const result1 = await hashFiles([thisFile, otherFile]);
		const result2 = await hashFiles([otherFile, thisFile]);
		expect(result1).toBe(result2);
	});

	it("returns empty string for empty array", async () => {
		const result = await hashFiles([]);
		expect(result).toBe("");
	});
});

describe("buildCacheKey", () => {
	it("returns a string", async () => {
		const key = await buildCacheKey({ task: "review" });
		expect(typeof key).toBe("string");
		expect(key.length).toBeGreaterThan(0);
	});

	it("same input produces same key", async () => {
		const input = { task: "review", model: "gpt-4o", extra: "abc" };
		const key1 = await buildCacheKey(input);
		const key2 = await buildCacheKey(input);
		expect(key1).toBe(key2);
	});

	it("different task produces different key", async () => {
		const key1 = await buildCacheKey({ task: "review" });
		const key2 = await buildCacheKey({ task: "commit" });
		expect(key1).not.toBe(key2);
	});

	it("different files produce different key", async () => {
		const key1 = await buildCacheKey({
			task: "review",
			files: [import.meta.path],
		});
		const key2 = await buildCacheKey({
			task: "review",
			files: ["/nonexistent/path.ts"],
		});
		expect(key1).not.toBe(key2);
	});

	it("returns a hex string of 64 characters", async () => {
		const key = await buildCacheKey({
			task: "explain",
			model: "claude-3",
			promptHash: "abc123",
		});
		expect(key).toMatch(/^[0-9a-f]{64}$/);
	});
});
