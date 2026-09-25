/**
 * MCP prompts (FR-MCP-3): `review-changes`, `pre-merge` and `plan-feature`
 * are listed with their arguments, render with the arguments a client
 * passes, and walk the host through tools this server actually registers.
 */

import { describe, expect, test } from "bun:test";
import { DECISION_CATALOG } from "@mainahq/core";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ALL_TOOLS, DEFAULT_TOOLS } from "../allowlist";
import { PROMPTS as DEFINITIONS } from "../prompts";
import { connect, fakeRuntime } from "./fixtures";

const PROMPTS = ["review-changes", "pre-merge", "plan-feature"] as const;

/** v1 tool names that no v2 server registers. */
const LEGACY_TOOLS = [
	"getContext",
	"reviewCode",
	"checkSlop",
	"getConventions",
	"explainModule",
	"suggestTests",
	"analyzeFeature",
	"wikiQuery",
	"wikiStatus",
	"reviewDesign",
];

/** Every argument a prompt accepts, filled in. */
const FULL_ARGS: Readonly<Record<string, Record<string, string>>> = {
	"review-changes": {
		base: "origin/develop",
		files: "src/a.ts, src/b.ts",
		focus: "error handling",
	},
	"pre-merge": {
		base: "origin/develop",
		files: "src/a.ts,src/b.ts",
		feature: ".maina/features/042-login",
		receipt: ".maina/receipts/head.json",
	},
	"plan-feature": {
		description: "Let users reset their password by email",
		feature: ".maina/features/043-password-reset",
	},
};

/** Only the required arguments. */
const MINIMAL_ARGS: Readonly<Record<string, Record<string, string>>> = {
	"review-changes": {},
	"pre-merge": {},
	"plan-feature": { description: "Add a dark mode toggle" },
};

async function render(
	client: Client,
	name: string,
	args: Record<string, string>,
): Promise<string> {
	const result = await client.getPrompt({ name, arguments: args });
	expect(result.messages.length).toBeGreaterThan(0);
	return result.messages
		.map((m) => (m.content.type === "text" ? m.content.text : ""))
		.join("\n");
}

/** Tool names a rendered prompt tells the host to call ("the `x` tool"). */
function referencedTools(text: string): string[] {
	return [...text.matchAll(/`([A-Za-z_]+)` tool/g)].map((m) => m[1] ?? "");
}

describe("prompt listing", () => {
	test("lists the three prompts with descriptions", async () => {
		const client = await connect(fakeRuntime().runtime);
		const { prompts } = await client.listPrompts();
		expect(prompts.map((p) => p.name).sort()).toEqual([...PROMPTS].sort());
		for (const prompt of prompts) {
			expect(prompt.description?.length ?? 0).toBeGreaterThan(20);
		}
	});

	test("declares each prompt's arguments and which are required", async () => {
		const client = await connect(fakeRuntime().runtime);
		const { prompts } = await client.listPrompts();
		const args = Object.fromEntries(
			prompts.map((p) => [
				p.name,
				Object.fromEntries(
					(p.arguments ?? []).map((a) => [a.name, a.required ?? false]),
				),
			]),
		);
		expect(args["review-changes"]).toEqual({
			base: false,
			files: false,
			focus: false,
		});
		expect(args["pre-merge"]).toEqual({
			base: false,
			files: false,
			feature: false,
			receipt: false,
		});
		expect(args["plan-feature"]).toEqual({
			description: true,
			feature: false,
		});
		for (const prompt of prompts) {
			for (const arg of prompt.arguments ?? []) {
				expect(arg.description?.length ?? 0).toBeGreaterThan(0);
			}
		}
	});
});

describe("review-changes", () => {
	test("renders the base, the files and the focus it was given", async () => {
		const client = await connect(fakeRuntime().runtime);
		const text = await render(
			client,
			"review-changes",
			FULL_ARGS["review-changes"] ?? {},
		);
		expect(text).toContain("origin/develop");
		expect(text).toContain('["src/a.ts","src/b.ts"]');
		expect(text).toContain("error handling");
		for (const tool of ["impact", "verify", "review_triage"]) {
			expect(referencedTools(text)).toContain(tool);
		}
	});

	test("falls back to the changed files against HEAD without arguments", async () => {
		const client = await connect(fakeRuntime().runtime);
		const text = await render(client, "review-changes", {});
		expect(text).toContain("HEAD");
		expect(text).not.toContain("undefined");
		expect(text).toContain("git diff --name-only --diff-filter=d HEAD");
	});
});

describe("pre-merge", () => {
	test("renders the gate over the base, files, feature and receipt", async () => {
		const client = await connect(fakeRuntime().runtime);
		const text = await render(
			client,
			"pre-merge",
			FULL_ARGS["pre-merge"] ?? {},
		);
		expect(text).toContain("origin/develop");
		expect(text).toContain('["src/a.ts","src/b.ts"]');
		expect(text).toContain('[".maina/features/042-login"]');
		expect(text).toContain('[".maina/receipts/head.json"]');
		for (const tool of [
			"status",
			"verify",
			"review_triage",
			"spec_check",
			"receipt",
		]) {
			expect(referencedTools(text)).toContain(tool);
		}
		expect(text).toMatch(/ready to merge/i);
	});

	test("skips the spec and receipt checks it has no paths for", async () => {
		const client = await connect(fakeRuntime().runtime);
		const text = await render(client, "pre-merge", {});
		const tools = referencedTools(text);
		expect(tools).not.toContain("spec_check");
		expect(tools).not.toContain("receipt");
		expect(tools).toContain("verify");
		expect(text).toContain("origin/main");
		expect(text).not.toContain("undefined");
	});
});

describe("plan-feature", () => {
	test("renders the description and the feature directory", async () => {
		const client = await connect(fakeRuntime().runtime);
		const text = await render(
			client,
			"plan-feature",
			FULL_ARGS["plan-feature"] ?? {},
		);
		expect(text).toContain("Let users reset their password by email");
		expect(text).toContain(".maina/features/043-password-reset");
		expect(text).toContain("spec.md");
		expect(text).toContain("plan.md");
		expect(text).toContain("[NEEDS CLARIFICATION]");
		for (const tool of ["context", "impact", "spec_check"]) {
			expect(referencedTools(text)).toContain(tool);
		}
	});

	test("refuses to render without a description", async () => {
		const client = await connect(fakeRuntime().runtime);
		await expect(
			client.getPrompt({ name: "plan-feature", arguments: {} }),
		).rejects.toThrow(/description/);
		await expect(
			client.getPrompt({
				name: "plan-feature",
				arguments: { description: "   " },
			}),
		).rejects.toThrow(/description/);
	});
});

describe("base argument", () => {
	test("refuses a base that is not a plain git ref", async () => {
		const client = await connect(fakeRuntime().runtime);
		for (const name of ["review-changes", "pre-merge"]) {
			for (const base of ["--output=/tmp/x", "main; rm -rf ~", "$(id)"]) {
				await expect(
					client.getPrompt({ name, arguments: { base } }),
				).rejects.toThrow(/base/);
			}
			const text = await render(client, name, { base: "origin/v1/main~2" });
			expect(text).toContain("origin/v1/main~2");
		}
	});

	test("refuses a base the shell would expand", async () => {
		const client = await connect(fakeRuntime().runtime);
		for (const name of ["review-changes", "pre-merge"]) {
			for (const base of ["~root", "^main"]) {
				await expect(
					client.getPrompt({ name, arguments: { base } }),
				).rejects.toThrow(/base/);
			}
		}
	});

	test("treats a blank base as absent, as clients send unfilled arguments", async () => {
		const client = await connect(fakeRuntime().runtime);
		for (const base of ["", "   "]) {
			const review = await render(client, "review-changes", { base });
			expect(review).toContain("git diff --name-only --diff-filter=d HEAD");
			const gate = await render(client, "pre-merge", { base });
			expect(gate).toContain("BASE");
			expect(gate).not.toContain("undefined");
		}
		const padded = await render(client, "pre-merge", {
			base: " origin/develop ",
		});
		expect(padded).toContain('base: "origin/develop"');
	});
});

describe("changed-file listing", () => {
	test("leaves deleted files out of FILES", async () => {
		const client = await connect(fakeRuntime().runtime);
		const review = await render(client, "review-changes", {});
		expect(review).toContain("git diff --name-only --diff-filter=d HEAD");
		const gate = await render(client, "pre-merge", {});
		expect(gate).toContain("git diff --name-only --diff-filter=d BASE...HEAD");
	});
});

describe("tool references", () => {
	test("every rendering names only tools the server registered", async () => {
		const client = await connect(fakeRuntime().runtime);
		const registered = (await client.listTools()).tools.map((t) => t.name);
		for (const name of PROMPTS) {
			for (const args of [MINIMAL_ARGS[name], FULL_ARGS[name]]) {
				const text = await render(client, name, args ?? {});
				const tools = referencedTools(text);
				expect(tools.length).toBeGreaterThan(0);
				for (const tool of tools) expect(registered).toContain(tool);
				for (const legacy of LEGACY_TOOLS) expect(text).not.toContain(legacy);
			}
		}
	});

	test("the default tool set covers every prompt", async () => {
		const client = await connect(fakeRuntime().runtime);
		const { prompts } = await client.listPrompts();
		expect(prompts).toHaveLength(PROMPTS.length);
		const tools = (await client.listTools()).tools.map((t) => t.name);
		expect(tools.sort()).toEqual([...DEFAULT_TOOLS].sort());
	});

	test("a prompt is listed only when every tool it names is registered", async () => {
		const client = await connect(fakeRuntime().runtime, {
			tools: ["context", "impact", "spec_check"],
		});
		const { prompts } = await client.listPrompts();
		expect(prompts.map((p) => p.name)).toEqual(["plan-feature"]);
	});

	test("each prompt declares every tool it names (served with only those)", async () => {
		for (const def of DEFINITIONS) {
			const client = await connect(fakeRuntime().runtime, {
				tools: [...def.tools],
			});
			const { prompts } = await client.listPrompts();
			expect(prompts.map((p) => p.name)).toContain(def.name);
			const registered = (await client.listTools()).tools.map((t) => t.name);
			const named = new Set<string>();
			for (const args of [MINIMAL_ARGS[def.name], FULL_ARGS[def.name]]) {
				const text = await render(client, def.name, args ?? {});
				for (const tool of referencedTools(text)) named.add(tool);
			}
			for (const tool of named) expect(registered).toContain(tool);
			expect([...named].sort()).toEqual([...def.tools].sort());
		}
	});

	test("no prompt is served when none of its tools are", async () => {
		const client = await connect(fakeRuntime().runtime, {
			tools: ["ask_question"],
		});
		await expect(
			client.getPrompt({ name: "review-changes", arguments: {} }),
		).rejects.toThrow();
	});

	test("decision types a prompt names exist in the catalog", async () => {
		const client = await connect(fakeRuntime().runtime, {
			tools: [...ALL_TOOLS],
		});
		const named = new Set<string>();
		for (const name of PROMPTS) {
			const text = await render(client, name, FULL_ARGS[name] ?? {});
			for (const m of text.matchAll(/decision type `([a-z_.]+)`/g)) {
				named.add(m[1] ?? "");
			}
		}
		// review-changes names `finding.real`; an empty set would pass vacuously.
		expect([...named]).toContain("finding.real");
		for (const type of named)
			expect(Object.keys(DECISION_CATALOG)).toContain(type);
	});
});
