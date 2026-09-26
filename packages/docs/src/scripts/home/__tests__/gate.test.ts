import { describe, expect, it } from "bun:test";
import corpus from "../../../../public/gate-corpus.json";
import {
	type CorpusRow,
	fetchCorpus,
	lookupCommand,
	normalizeCommand,
} from "../gate";

const rows = corpus as unknown as readonly CorpusRow[];

describe("normalizeCommand", () => {
	it("trims and collapses runs of whitespace", () => {
		expect(normalizeCommand("  rm   -rf \t ~  ")).toBe("rm -rf ~");
	});
});

describe("lookupCommand", () => {
	it("finds a corpus command however it is spaced", () => {
		const row = lookupCommand(rows, "  rm   -rf ~ ");
		expect(row?.c).toBe("rm -rf ~");
		expect(["ask", "deny"]).toContain(row?.v ?? "");
	});

	it("returns null for a command the build did not evaluate", () => {
		expect(lookupCommand(rows, "echo not-in-the-corpus-360")).toBeNull();
	});

	it("carries a verdict, a reason and the classes for every row", () => {
		expect(rows.length).toBeGreaterThan(500);
		for (const row of rows) {
			expect(["allow", "ask", "deny"]).toContain(row.v);
			expect(typeof row.r).toBe("string");
			expect(Array.isArray(row.k)).toBe(true);
		}
	});
});

describe("fetchCorpus", () => {
	const reply = (status: number, body: unknown) => async () =>
		new Response(JSON.stringify(body), { status });

	it("returns the rows the server sends", async () => {
		const got = await fetchCorpus(
			reply(200, [{ c: "ls", v: "allow", r: "x", k: [] }]),
			"/gate-corpus.json",
		);
		expect(got?.[0]?.c).toBe("ls");
	});

	// A failed load is not "not in the corpus": the page says it could not
	// load, and tries again on the next check.
	it("returns null on an HTTP error, a network error or a non-array body", async () => {
		expect(await fetchCorpus(reply(404, []), "/gate-corpus.json")).toBeNull();
		expect(
			await fetchCorpus(reply(200, { rows: [] }), "/gate-corpus.json"),
		).toBeNull();
		const offline = async (): Promise<Response> => {
			throw new TypeError("offline");
		};
		expect(await fetchCorpus(offline, "/gate-corpus.json")).toBeNull();
	});
});
