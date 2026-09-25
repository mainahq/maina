/**
 * DeepWiki-compatible tools (ADR 0037): `ask_question`,
 * `read_wiki_structure` and `read_wiki_contents`, with DeepWiki's argument
 * names so clients that already speak DeepWiki work unchanged. They are not
 * in the default tool set; enable them through the allow-list
 * (`--tools default,ask_question` or `MAINA_MCP_TOOLS`).
 */

import { isAbsolute, posix } from "node:path";
import { z } from "zod";
import { capped, defineTool, invalid, ok, plural, rootInput } from "./shared";

const repoInput = z
	.string()
	.optional()
	.describe(
		"DeepWiki compatibility; maina answers for the repository at `root`.",
	);

export const askQuestionTool = defineTool({
	name: "ask_question",
	description:
		"Ask a question about the codebase. Answers from the maina wiki with source articles (DeepWiki-compatible).",
	readOnly: true,
	input: {
		root: rootInput,
		repo: repoInput,
		question: z.string().min(1).describe("The question to answer."),
	},
	data: z.object({ answer: z.string(), sources: z.array(z.string()) }),
	run: async (args, { root, runtime }) => {
		const result = await runtime.wiki.ask({ root, question: args.question });
		if (!result.ok) return result;
		const { answer, sources } = result.value;
		const summary = [
			answer,
			...(sources.length > 0
				? ["", "sources:", ...sources.map((s) => `- ${s}`)]
				: []),
		].join("\n");
		return ok({ data: { answer, sources: [...sources] }, summary });
	},
});

export const readWikiStructureTool = defineTool({
	name: "read_wiki_structure",
	description:
		"List the maina wiki's articles with their paths, types and titles (DeepWiki-compatible).",
	readOnly: true,
	input: { root: rootInput, repo: repoInput },
	data: z.object({
		articles: z.array(
			z.object({ path: z.string(), type: z.string(), title: z.string() }),
		),
		total: z.number(),
	}),
	run: async (_args, { root, runtime }) => {
		const result = await runtime.wiki.structure({ root });
		if (!result.ok) return result;
		const articles = result.value.map((a) => ({
			path: a.path,
			type: a.type,
			title: a.title,
		}));
		const summary = [
			`wiki: ${plural(articles.length, "article")}`,
			...capped(
				articles.map((a) => `- ${a.path} (${a.type})`),
				100,
			),
		].join("\n");
		return ok({ data: { articles, total: articles.length }, summary });
	},
});

export const readWikiContentsTool = defineTool({
	name: "read_wiki_contents",
	description:
		"Read one maina wiki article by its path from read_wiki_structure (DeepWiki-compatible).",
	readOnly: true,
	input: {
		root: rootInput,
		repo: repoInput,
		page: z
			.string()
			.min(1)
			.describe("Article path inside the wiki, e.g. modules/auth.md."),
	},
	data: z.object({ page: z.string(), content: z.string() }),
	run: async (args, { root, runtime }) => {
		const page = posix.normalize(args.page.replaceAll("\\", "/"));
		if (isAbsolute(args.page) || page === ".." || page.startsWith("../")) {
			return invalid(`${args.page} is outside the wiki`);
		}
		const result = await runtime.wiki.contents({ root, page });
		if (!result.ok) return result;
		return ok({
			data: { page, content: result.value },
			summary: result.value,
		});
	},
});
