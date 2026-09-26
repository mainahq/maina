/**
 * The ACP Registry listing (mainahq/maina#319, FR-HAR-3): `maina.json` is
 * the `agent.json` submitted to github.com/agentclientprotocol/registry, so
 * editors that read the registry (Zed, JetBrains) can install maina as an
 * agent. These checks mirror the registry's `agent.schema.json` offline:
 * the required fields, their formats, and a pinned npx package whose
 * version is the entry's own, launched in proxy mode (`maina acp`).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acpCommand } from "../../../packages/cli/src/commands/acp";

const ENTRY = JSON.parse(
	readFileSync(join(import.meta.dir, "..", "maina.json"), "utf8"),
) as Record<string, unknown>;

const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const isUrl = (value: unknown): boolean =>
	typeof value === "string" && /^https:\/\/\S+$/.test(value);

describe("integrations/acp-registry/maina.json", () => {
	test("has every field the registry requires, in its format", () => {
		expect(ENTRY.id).toBe("maina");
		expect(ENTRY.id).toMatch(/^[a-z][a-z0-9-]*$/);
		expect(typeof ENTRY.name).toBe("string");
		expect(ENTRY.version).toMatch(SEMVER);
		expect(String(ENTRY.description).length).toBeGreaterThan(0);
		expect(ENTRY.license).toBe("Apache-2.0");
		expect(isUrl(ENTRY.license_url)).toBe(true);
		expect(isUrl(ENTRY.repository)).toBe(true);
		expect(isUrl(ENTRY.website)).toBe(true);
		expect(Array.isArray(ENTRY.authors)).toBe(true);
	});

	test("installs the CLI at the entry's version and starts it in proxy mode", () => {
		const distribution = ENTRY.distribution as Record<string, unknown>;
		expect(Object.keys(distribution)).toEqual(["npx"]);
		const npx = distribution.npx as { package: string; args: string[] };
		expect(npx.package).toBe(`@mainahq/cli@${ENTRY.version}`);
		expect(npx.args).toEqual(["acp"]);
	});

	test("the command it runs exists: `maina acp`, whose --agent has a default", () => {
		const cmd = acpCommand();
		expect(cmd.name()).toBe("acp");
		const agent = cmd.options.find((o) => o.long === "--agent");
		expect(agent?.defaultValue).toBeDefined();
	});
});
