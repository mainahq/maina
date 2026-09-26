/**
 * The docs files `scripts/docs-manifest.ts` generates (#357). Dependency
 * free, so the other docs checks can skip them without loading the
 * registries they are generated from.
 */

const DOCS = "packages/docs/src/content/docs";

/** Repo-relative paths of every generated docs file. */
export const GENERATED_DOCS: readonly string[] = [
	"packages/docs/src/data/facts.ts",
	`${DOCS}/reference/commands.mdx`,
	`${DOCS}/reference/mcp-tools.mdx`,
	`${DOCS}/reference/hooks.mdx`,
	`${DOCS}/reference/config.mdx`,
	`${DOCS}/reference/policy.mdx`,
	`${DOCS}/reference/decision-types.mdx`,
	`${DOCS}/roadmap.mdx`,
	`${DOCS}/changelog.mdx`,
	`${DOCS}/benchmarks.mdx`,
];
