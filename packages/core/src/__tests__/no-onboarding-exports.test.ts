/**
 * Core owns engines, not onboarding (issue #287, FR-INS-5).
 *
 * `maina init` / `maina setup` scaffolding and per-host MCP client config
 * writers are CLI concerns and live in `packages/cli/src/{onboarding,hosts}`.
 * This test pins that `@mainahq/core` exposes none of them, and that the old
 * core modules are gone rather than merely unexported.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as core from "../index";

const CORE_SRC = join(import.meta.dir, "..");

/** Every value the core barrel exported from init/, setup/ and mcp/ before the move. */
const MOVED_EXPORTS = [
	"ALL_AGENTS",
	"MAINA_MCP_KEY",
	"MAINA_REGION_END",
	"MAINA_REGION_START",
	"adoptRules",
	"anonymizeStack",
	"assembleStackContext",
	"bootstrap",
	"buildClientRegistry",
	"buildGenericConstitution",
	"buildGenericConstitutionFromInput",
	"buildMainaEntry",
	"buildMainaSection",
	"confirmRules",
	"contextHash",
	"degradedBanner",
	"deploySkills",
	"detectExistingRuleFiles",
	"detectLauncher",
	"deviceFingerprint",
	"extractManaged",
	"formatProvenanceComment",
	"generateAgentsMd",
	"generateClaudeMd",
	"generateCopilotInstructions",
	"generateCursorRules",
	"generateWindsurfRules",
	"getUniversalPromptPath",
	"isDirectBinary",
	"isTelemetryOptedOut",
	"listClientIds",
	"loadUniversalPrompt",
	"mergeJsonKeyed",
	"mergeManaged",
	"newSetupId",
	"recoveryCommand",
	"renderFileLayoutSection",
	"renderWorkflowSection",
	"resetLauncherCache",
	"resolveSetupAI",
	"runAdd",
	"runList",
	"runRemove",
	"scanGitLog",
	"scanLintConfig",
	"scanRepo",
	"scanTreeSitter",
	"sendSetupTelemetry",
	"summarizeRepo",
	"tailorConstitution",
	"validateConstitution",
	"wrapManaged",
	"writeAllAgentFiles",
	"writeClaudeMd",
	"writeClaudeSettings",
	"writeCursorMcp",
] as const;

/** Name shapes that signal onboarding or host-config code leaking back in. */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
	/^init[A-Z]/,
	/^setup[A-Z]/,
	/Setup(AI|Id|Telemetry)$/,
	/^(build|resolve|detect)(MainaEntry|Launcher)$/,
	/^write(All)?(Agent|Claude|Cursor|Windsurf|Copilot)/,
	/ClientRegistry$/,
];

describe("core barrel has no onboarding or host-config exports", () => {
	const exported = Object.keys(core);

	test.each([...MOVED_EXPORTS])("does not export %s", (name) => {
		expect(exported).not.toContain(name);
	});

	test("no export matches an onboarding/host-config name shape", () => {
		const leaks = exported.filter((name) =>
			FORBIDDEN_PATTERNS.some((re) => re.test(name)),
		);
		expect(leaks).toEqual([]);
	});
});

describe("onboarding and host-config modules are gone from core", () => {
	test.each([
		"init",
		"setup",
		"mcp/clients.ts",
		"mcp/launcher.ts",
		"mcp/entry.ts",
		"mcp/apply.ts",
	])("packages/core/src/%s does not exist", (path) => {
		expect(existsSync(join(CORE_SRC, path))).toBe(false);
	});
});
