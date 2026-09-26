/** A host maina generates a plugin package for. */
export type Host = "claude" | "cursor" | "codex" | "agent-plugins";

/** One file of a generated package, by its path from the plugin root. */
export type GeneratedFile = Readonly<{
	path: string;
	content: string;
	executable: boolean;
}>;

/** The files a package bundles, read from the repo by `../sources.ts`. */
export type Sources = Readonly<{
	/** The runtime version the launcher pins, which is the plugin's version. */
	version: string;
	/** Each skill's `SKILL.md`, by folder name. */
	skills: readonly Readonly<{ name: string; content: string }>[];
	/** The launcher files, by path from the launcher folder. */
	launcher: readonly GeneratedFile[];
}>;
