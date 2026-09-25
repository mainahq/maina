export default {
	extends: ["@commitlint/config-conventional"],
	rules: {
		"scope-enum": [
			2,
			"always",
			[
				"cli",
				"core",
				"runtime",
				"harness",
				"adapters",
				"mcp",
				"skills",
				"docs",
				"ci",
			],
		],
	},
};
