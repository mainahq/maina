import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMemoryFs } from "../../ports/testing";
import { getDefaultConfig, loadConfig } from "../index";
import { configJsonSchema, renderJsonSchema } from "../schema";

const ROOT = "/repo";
const CONFIG_PATH = "/repo/.maina/config.json";
const REPO_SCHEMAS = join(import.meta.dir, "../../../../../schemas");

function portsWith(files: Readonly<Record<string, string>>) {
	return { fs: createMemoryFs(files) };
}

describe("loadConfig(ports, root)", () => {
	test("returns the defaults when the repo has no config file", async () => {
		const result = await loadConfig(portsWith({}), ROOT);
		expect(result).toEqual({ ok: true, value: getDefaultConfig() });
	});

	test("returns every validation error with its path, not just the first", async () => {
		const result = await loadConfig(
			portsWith({
				[CONFIG_PATH]: JSON.stringify({
					models: { standard: 42 },
					provider: "",
					budget: { dailyUsd: -1, onBreach: "explode" },
					modles: {},
				}),
			}),
			ROOT,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const paths = result.error.map((e) => e.path).sort();
		expect(paths).toEqual([
			"",
			"budget.dailyUsd",
			"budget.onBreach",
			"models.standard",
			"provider",
		]);
		for (const error of result.error) {
			expect(error.kind).toBe("invalid");
			expect(error.file).toBe(CONFIG_PATH);
			expect(error.message.length).toBeGreaterThan(0);
		}
		const unknown = result.error.find((e) => e.path === "");
		expect(unknown?.message).toContain("modles");
	});

	test("reports malformed JSON as a parse error for that file", async () => {
		const result = await loadConfig(
			portsWith({ [CONFIG_PATH]: "{ nope" }),
			ROOT,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toHaveLength(1);
		expect(result.error[0]?.kind).toBe("parse");
		expect(result.error[0]?.file).toBe(CONFIG_PATH);
	});

	test("deep-merges a partial file over the defaults instead of replacing nested objects", async () => {
		const result = await loadConfig(
			portsWith({
				[CONFIG_PATH]: JSON.stringify({
					models: { standard: "anthropic/claude-sonnet-5" },
					budget: { perTaskUsd: 2 },
				}),
			}),
			ROOT,
		);
		const defaults = getDefaultConfig();
		expect(result).toEqual({
			ok: true,
			value: {
				...defaults,
				models: { ...defaults.models, standard: "anthropic/claude-sonnet-5" },
				budget: { ...defaults.budget, perTaskUsd: 2 },
			},
		});
	});

	test("rejects the removed, unenforced 1.x budget keys", async () => {
		const result = await loadConfig(
			portsWith({
				[CONFIG_PATH]: JSON.stringify({ budget: { daily: 5, alertAt: 0.8 } }),
			}),
			ROOT,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.map((e) => e.path)).toEqual(["budget"]);
		expect(result.error[0]?.message).toContain("daily");
	});

	test("the budget is enforceable: caps plus what to do on a breach", () => {
		expect(getDefaultConfig().budget).toEqual({
			dailyUsd: 5,
			perTaskUsd: 0.5,
			onBreach: "degrade",
		});
	});

	test("accepts the keys 1.x already writes to .maina/config.json", async () => {
		const result = await loadConfig(
			portsWith({
				[CONFIG_PATH]: JSON.stringify({
					$schema: "../schemas/maina.config.schema.json",
					telemetry: false,
					repoAliases: { cloud: "mainahq/maina-cloud" },
				}),
			}),
			ROOT,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.telemetry).toBe(false);
		expect(result.value.repoAliases).toEqual({ cloud: "mainahq/maina-cloud" });
		expect("$schema" in result.value).toBe(false);
	});
});

describe("maina.config JSON Schema", () => {
	test("the committed schemas/maina.config.schema.json is the generated one", () => {
		const committed = readFileSync(
			join(REPO_SCHEMAS, "maina.config.schema.json"),
			"utf-8",
		);
		expect(committed).toBe(renderJsonSchema(configJsonSchema()));
	});

	test("its properties match the TS Config type", () => {
		const schema = configJsonSchema() as {
			properties: Record<string, { properties?: Record<string, unknown> }>;
		};
		const defaults = getDefaultConfig();
		expect(Object.keys(schema.properties).sort()).toEqual(
			["$schema", "telemetry", ...Object.keys(defaults)].sort(),
		);
		expect(
			Object.keys(schema.properties.models?.properties ?? {}).sort(),
		).toEqual(Object.keys(defaults.models).sort());
		expect(
			Object.keys(schema.properties.budget?.properties ?? {}).sort(),
		).toEqual(Object.keys(defaults.budget).sort());
	});
});
