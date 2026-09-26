/**
 * The docs site's sidebar and redirects (#358, FR-DOC-2), in one module so
 * the Astro config and the docs checks (`scripts/docs-links.ts` and
 * `scripts/__tests__/install-docs.test.ts`) read the same data.
 *
 * Install-first: Install, Concepts, Guides, Reference, Benchmarks,
 * Changelog. Every page under `src/content/docs` is listed exactly once.
 */

/**
 * Old URLs. A key without its trailing slash serves both forms: Astro
 * reports `/a` and `/a/` as the same route.
 */
export const REDIRECTS: Readonly<Record<string, string>> = {
	"/quickstart": "/install/",
	"/getting-started": "/install/",
	"/full-setup": "/install/",
};

export const SIDEBAR = [
	{
		label: "Install",
		items: [
			{ slug: "install" },
			{ slug: "cursor" },
			{ slug: "codex" },
			{ slug: "vscode" },
			{ slug: "mcp" },
			{ slug: "self-host" },
		],
	},
	{
		label: "Concepts",
		items: [
			{ slug: "engines/context" },
			{ slug: "engines/prompt" },
			{ slug: "engines/verify" },
			{ slug: "skills" },
			{ slug: "wiki" },
			{ slug: "privacy" },
		],
	},
	{
		label: "Guides",
		items: [
			{ slug: "ci" },
			{ slug: "cloud" },
			{ slug: "feedback" },
			{ slug: "copy-discipline" },
			{
				label: "Cookbooks",
				items: [
					{ slug: "cookbooks/verify-pr-in-ci" },
					{ slug: "cookbooks/claude-code-self-check" },
					{ slug: "cookbooks/coderabbit-integration" },
					{ slug: "cookbooks/constitution-required-check" },
					{ slug: "cookbooks/playwright-mcp" },
				],
			},
		],
	},
	{
		label: "Reference",
		items: [
			{ slug: "commands" },
			{ slug: "configuration" },
			{ slug: "reference/commands" },
			{ slug: "reference/mcp-tools" },
			{ slug: "reference/hooks" },
			{ slug: "reference/config" },
			{ slug: "reference/policy" },
			{ slug: "reference/decision-types" },
		],
	},
	{
		label: "Benchmarks",
		items: [{ slug: "benchmarks" }],
	},
	{
		label: "Changelog",
		items: [
			{ slug: "changelog" },
			{ slug: "roadmap" },
			{
				label: "Blog",
				collapsed: true,
				items: [
					{ slug: "blog/verification-gap" },
					{ slug: "blog/why-no-sdk" },
					{ slug: "blog/why-not-passmark" },
					{ slug: "blog/why-not-custom-search" },
					{ slug: "blog/wiki-is-a-view" },
				],
			},
		],
	},
];
