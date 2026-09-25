/**
 * Tool schemas are part of the wire contract: a change to a name, an input
 * or the structured output shape must show up as a snapshot diff in review.
 */

import { describe, expect, test } from "bun:test";
import { ALL_TOOLS } from "../allowlist";
import { connect, fakeRuntime } from "./fixtures";

type JsonSchema = {
	type?: string;
	properties?: Record<string, unknown>;
	required?: string[];
};

async function listAll() {
	const client = await connect(fakeRuntime().runtime, {
		tools: [...ALL_TOOLS],
	});
	return (await client.listTools()).tools;
}

/** Tools whose target is a set of files, paths or a free-text query. */
const TARGETED = [
	"verify",
	"impact",
	"context",
	"review_triage",
	"spec_check",
	"receipt",
];

describe("tool schemas", () => {
	test("match the snapshot", async () => {
		const tools = await listAll();
		for (const tool of tools) {
			expect({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
				outputSchema: tool.outputSchema,
				annotations: tool.annotations,
			}).toMatchSnapshot(tool.name);
		}
	});

	test("every tool takes an explicit root", async () => {
		for (const tool of await listAll()) {
			const input = tool.inputSchema as JsonSchema;
			expect(Object.keys(input.properties ?? {})).toContain("root");
			expect(input.required ?? []).not.toContain("root");
		}
	});

	test("every targeted tool takes explicit files, paths or a query", async () => {
		const tools = await listAll();
		for (const name of TARGETED) {
			const tool = tools.find((t) => t.name === name);
			const props = Object.keys(
				(tool?.inputSchema as JsonSchema | undefined)?.properties ?? {},
			);
			expect(
				props.some((p) => p === "files" || p === "paths" || p === "query"),
			).toBe(true);
		}
	});

	test("every tool declares a { data, error, meta } structured output", async () => {
		for (const tool of await listAll()) {
			const output = tool.outputSchema as JsonSchema | undefined;
			expect(output?.type).toBe("object");
			expect(Object.keys(output?.properties ?? {}).sort()).toEqual([
				"data",
				"error",
				"meta",
			]);
		}
	});

	test("every tool is annotated read-only or not", async () => {
		for (const tool of await listAll()) {
			expect(typeof tool.annotations?.readOnlyHint).toBe("boolean");
		}
	});
});
