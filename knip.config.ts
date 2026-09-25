import type { KnipConfig } from "knip";

const config: KnipConfig = {
	workspaces: {
		".": {
			ignoreDependencies: ["bun-types"],
		},
		"packages/cli": {
			entry: ["src/index.ts"],
			project: ["src/**/*.ts"],
			ignore: ["src/**/__tests__/**"],
			// Action functions + DI types are exported for test injection
			ignoreDependencies: ["@maina/mcp"],
		},
		"packages/core": {
			entry: ["src/index.ts"],
			project: ["src/**/*.ts"],
			ignore: ["src/**/__tests__/**", "src/__golden__/**"],
		},
		"packages/mcp": {
			entry: ["src/index.ts"],
			project: ["src/**/*.ts"],
			ignore: ["src/**/__tests__/**"],
		},
		"packages/skills": {
			entry: [],
			project: ["**/*.ts"],
		},
		"packages/docs": {
			entry: ["src/content.config.ts", "astro.config.mjs"],
			project: ["src/**/*.{ts,astro,mdx}"],
			ignore: ["dist/**", ".astro/**"],
		},
	},
	ignore: [".maina/**", "examples/**", "scripts/**"],
	ignoreBinaries: ["tsc"],
};

export default config;
