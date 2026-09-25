import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderJsonSchema } from "../../config/schema";
import { DEFAULT_POLICY } from "../defaults";
import { parsePolicyLayer, policyJsonSchema } from "../schema";

const REPO_SCHEMAS = join(import.meta.dir, "../../../../../schemas");

describe("policy JSON Schema", () => {
	test("the committed schemas/policy.schema.json is the generated one", () => {
		const committed = readFileSync(
			join(REPO_SCHEMAS, "policy.schema.json"),
			"utf-8",
		);
		expect(committed).toBe(renderJsonSchema(policyJsonSchema()));
	});

	test("its properties match the TS Policy type", () => {
		const schema = policyJsonSchema() as {
			properties: Record<string, unknown>;
		};
		const policyKeys = Object.keys(DEFAULT_POLICY).filter(
			(key) => key !== "loosened",
		);
		expect(Object.keys(schema.properties).sort()).toEqual(
			["$schema", "version", "explicitly_allow", ...policyKeys].sort(),
		);
	});

	test("a rule accepts an optional boolean `exact`", () => {
		expect(
			parsePolicyLayer(
				{ rules: { allow: [{ match: "bun test", exact: true }] } },
				"user",
			).ok,
		).toBe(true);
		expect(
			parsePolicyLayer(
				{ rules: { allow: [{ match: "bun test", exact: "yes" }] } },
				"user",
			).ok,
		).toBe(false);
		const schema = policyJsonSchema() as {
			properties: {
				rules: {
					properties: {
						allow: { items: { properties: Record<string, { type?: string }> } };
					};
				};
			};
		};
		expect(
			schema.properties.rules.properties.allow.items.properties.exact?.type,
		).toBe("boolean");
	});

	test("describes log.paths as hashed | plain", () => {
		const schema = policyJsonSchema() as {
			properties: {
				log?: { properties?: { paths?: { enum?: readonly string[] } } };
			};
		};
		expect(schema.properties.log?.properties?.paths?.enum).toEqual([
			"hashed",
			"plain",
		]);
	});

	test("the default policy, written out as a file, is a valid policy layer", () => {
		const { loosened: _loosened, ...layer } = DEFAULT_POLICY;
		expect(parsePolicyLayer({ version: 1, ...layer }).ok).toBe(true);
	});
});
