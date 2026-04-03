import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getNextAdrNumber, listAdrs, scaffoldAdr } from "../index";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-design-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("getNextAdrNumber", () => {
	let tmpDir: string;
	let adrDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		adrDir = join(tmpDir, "adr");
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("empty dir returns '0001'", async () => {
		mkdirSync(adrDir, { recursive: true });
		const result = await getNextAdrNumber(adrDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("0001");
		}
	});

	test("existing 0001, 0002 returns '0003'", async () => {
		mkdirSync(adrDir, { recursive: true });
		await Bun.write(
			join(adrDir, "0001-use-bun-runtime.md"),
			"# 0001. Use Bun Runtime\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n",
		);
		await Bun.write(
			join(adrDir, "0002-use-biome.md"),
			"# 0002. Use Biome\n\nDate: 2026-01-02\n\n## Status\n\nProposed\n",
		);
		const result = await getNextAdrNumber(adrDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("0003");
		}
	});

	test("creates adr/ if missing", async () => {
		expect(existsSync(adrDir)).toBe(false);
		const result = await getNextAdrNumber(adrDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("0001");
		}
		expect(existsSync(adrDir)).toBe(true);
	});

	test("non-sequential (0001, 0003) returns '0004'", async () => {
		mkdirSync(adrDir, { recursive: true });
		await Bun.write(
			join(adrDir, "0001-first.md"),
			"# 0001. First\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n",
		);
		await Bun.write(
			join(adrDir, "0003-third.md"),
			"# 0003. Third\n\nDate: 2026-01-03\n\n## Status\n\nProposed\n",
		);
		const result = await getNextAdrNumber(adrDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("0004");
		}
	});

	test("ignores files without numeric prefix", async () => {
		mkdirSync(adrDir, { recursive: true });
		await Bun.write(join(adrDir, "README.md"), "# ADR Directory");
		await Bun.write(
			join(adrDir, "0001-first.md"),
			"# 0001. First\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n",
		);
		const result = await getNextAdrNumber(adrDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe("0002");
		}
	});
});

describe("scaffoldAdr", () => {
	let tmpDir: string;
	let adrDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		adrDir = join(tmpDir, "adr");
		mkdirSync(adrDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("creates file with MADR template", async () => {
		const result = await scaffoldAdr(adrDir, "0001", "Use Bun Runtime");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(existsSync(result.value)).toBe(true);
			expect(result.value).toContain("0001-use-bun-runtime.md");
		}
	});

	test("file contains title, date, status sections", async () => {
		const result = await scaffoldAdr(adrDir, "0001", "Use Bun Runtime");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const content = readFileSync(result.value, "utf-8");
			expect(content).toContain("# 0001. Use Bun Runtime");
			expect(content).toContain("Date:");
			expect(content).toContain("## Status");
			expect(content).toContain("Proposed");
			expect(content).toContain("## Context");
			expect(content).toContain("## Decision");
			expect(content).toContain("## Consequences");
			expect(content).toContain("### Positive");
			expect(content).toContain("### Negative");
			expect(content).toContain("### Neutral");
		}
	});

	test("file contains [NEEDS CLARIFICATION] markers", async () => {
		const result = await scaffoldAdr(adrDir, "0001", "Use Bun Runtime");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const content = readFileSync(result.value, "utf-8");
			expect(content).toContain("[NEEDS CLARIFICATION]");
		}
	});

	test("returns the file path", async () => {
		const result = await scaffoldAdr(
			adrDir,
			"0002",
			"Choose Biome Over ESLint",
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(
				join(adrDir, "0002-choose-biome-over-eslint.md"),
			);
		}
	});

	test("converts title to kebab-case for filename", async () => {
		const result = await scaffoldAdr(adrDir, "0001", "My Cool Decision");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toContain("0001-my-cool-decision.md");
		}
	});

	test("date is today's date in YYYY-MM-DD format", async () => {
		const result = await scaffoldAdr(adrDir, "0001", "Test Date");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const content = readFileSync(result.value, "utf-8");
			const today = new Date().toISOString().split("T")[0];
			expect(content).toContain(`Date: ${today}`);
		}
	});
});

describe("listAdrs", () => {
	let tmpDir: string;
	let adrDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		adrDir = join(tmpDir, "adr");
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("empty dir returns empty array", async () => {
		mkdirSync(adrDir, { recursive: true });
		const result = await listAdrs(adrDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual([]);
		}
	});

	test("returns summaries with number, title, status", async () => {
		mkdirSync(adrDir, { recursive: true });
		await Bun.write(
			join(adrDir, "0001-use-bun-runtime.md"),
			"# 0001. Use Bun Runtime\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n",
		);
		await Bun.write(
			join(adrDir, "0002-use-biome.md"),
			"# 0002. Use Biome\n\nDate: 2026-01-02\n\n## Status\n\nProposed\n",
		);
		const result = await listAdrs(adrDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.length).toBe(2);

			const first = result.value.find((a) => a.number === "0001");
			expect(first).toBeDefined();
			expect(first?.title).toBe("Use Bun Runtime");
			expect(first?.status).toBe("Accepted");
			expect(first?.path).toContain("0001-use-bun-runtime.md");

			const second = result.value.find((a) => a.number === "0002");
			expect(second).toBeDefined();
			expect(second?.title).toBe("Use Biome");
			expect(second?.status).toBe("Proposed");
		}
	});

	test("ignores non-ADR files", async () => {
		mkdirSync(adrDir, { recursive: true });
		await Bun.write(join(adrDir, "README.md"), "# ADR Directory");
		await Bun.write(
			join(adrDir, "0001-first.md"),
			"# 0001. First\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n",
		);
		const result = await listAdrs(adrDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.length).toBe(1);
			expect(result.value[0]?.number).toBe("0001");
		}
	});

	test("returns error if adr/ does not exist", async () => {
		const result = await listAdrs(join(tmpDir, "nonexistent"));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBeDefined();
		}
	});

	test("results are sorted by number", async () => {
		mkdirSync(adrDir, { recursive: true });
		await Bun.write(
			join(adrDir, "0003-third.md"),
			"# 0003. Third\n\nDate: 2026-01-03\n\n## Status\n\nProposed\n",
		);
		await Bun.write(
			join(adrDir, "0001-first.md"),
			"# 0001. First\n\nDate: 2026-01-01\n\n## Status\n\nAccepted\n",
		);
		await Bun.write(
			join(adrDir, "0002-second.md"),
			"# 0002. Second\n\nDate: 2026-01-02\n\n## Status\n\nDeprecated\n",
		);
		const result = await listAdrs(adrDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value[0]?.number).toBe("0001");
			expect(result.value[1]?.number).toBe("0002");
			expect(result.value[2]?.number).toBe("0003");
		}
	});
});
