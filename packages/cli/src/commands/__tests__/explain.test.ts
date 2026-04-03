import { describe, expect, test } from "bun:test";
import type { ExplainDeps } from "../explain";
import { explainAction } from "../explain";

// ── Mock deps factory ──────────────────────────────────────────────────────

function createMockDeps(overrides?: Partial<ExplainDeps>): ExplainDeps {
	return {
		generateDependencyDiagram:
			overrides?.generateDependencyDiagram ??
			((_mainaDir, _options) => ({
				ok: true as const,
				value: "graph LR\n  context/engine --> context/budget\n",
			})),
		generateModuleSummary:
			overrides?.generateModuleSummary ??
			((_mainaDir) => ({
				ok: true as const,
				value: [
					{
						module: "context/engine",
						entityCount: 3,
						functions: 2,
						classes: 0,
						interfaces: 1,
						types: 0,
					},
				],
			})),
	};
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("explainAction", () => {
	test("default output shows diagram and summary", async () => {
		const deps = createMockDeps();
		const result = await explainAction({ cwd: "/tmp/test" }, deps);

		expect(result.displayed).toBe(true);
		expect(result.diagram).toContain("graph LR");
		expect(result.summaries).toBeDefined();
		expect(result.summaries?.length).toBe(1);
		expect(result.summaries?.[0]?.module).toBe("context/engine");
	});

	test("--scope flag passes scope to generateDependencyDiagram", async () => {
		let capturedScope: string | undefined;

		const deps = createMockDeps({
			generateDependencyDiagram: (_mainaDir, options) => {
				capturedScope = options?.scope;
				return {
					ok: true,
					value: "graph LR\n  context/engine --> context/budget\n",
				};
			},
		});

		await explainAction({ cwd: "/tmp/test", scope: "context" }, deps);

		expect(capturedScope).toBe("context");
	});

	test("--output flag sets outputPath in result", async () => {
		const deps = createMockDeps();
		const result = await explainAction(
			{ cwd: "/tmp/test", output: "/tmp/diagram.md" },
			deps,
		);

		expect(result.displayed).toBe(true);
		expect(result.outputPath).toBe("/tmp/diagram.md");
	});

	test("empty codebase shows helpful message", async () => {
		const deps = createMockDeps({
			generateDependencyDiagram: () => ({
				ok: true,
				value: "graph LR\n",
			}),
			generateModuleSummary: () => ({
				ok: true,
				value: [],
			}),
		});

		const result = await explainAction({ cwd: "/tmp/test" }, deps);

		expect(result.displayed).toBe(true);
		expect(result.empty).toBe(true);
		expect(result.diagram).toBe("graph LR\n");
		expect(result.summaries).toEqual([]);
	});

	test("diagram error returns displayed:false with reason", async () => {
		const deps = createMockDeps({
			generateDependencyDiagram: () => ({
				ok: false,
				error: "Database not found",
			}),
		});

		const result = await explainAction({ cwd: "/tmp/test" }, deps);

		expect(result.displayed).toBe(false);
		expect(result.reason).toBe("Database not found");
	});

	test("summary error returns displayed:false with reason", async () => {
		const deps = createMockDeps({
			generateModuleSummary: () => ({
				ok: false,
				error: "Schema mismatch",
			}),
		});

		const result = await explainAction({ cwd: "/tmp/test" }, deps);

		expect(result.displayed).toBe(false);
		expect(result.reason).toBe("Schema mismatch");
	});
});
