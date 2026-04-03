import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../db/index";
import type { LoadedStory, StoryConfig } from "./types";

/**
 * List all available benchmark stories in the given directory.
 * Each story must have a valid story.json to be included.
 */
export function listStories(storiesDir: string): Result<StoryConfig[]> {
	if (!existsSync(storiesDir)) {
		return { ok: true, value: [] };
	}

	const entries = readdirSync(storiesDir, { withFileTypes: true });
	const stories: StoryConfig[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;

		const configPath = join(storiesDir, entry.name, "story.json");
		if (!existsSync(configPath)) continue;

		try {
			const raw = readFileSync(configPath, "utf-8");
			const config = JSON.parse(raw) as StoryConfig;
			if (config.name && config.description) {
				stories.push(config);
			}
		} catch {
			// Skip invalid configs
		}
	}

	return { ok: true, value: stories };
}

/**
 * Load a specific story by name, including its config, spec, and test files.
 */
export function loadStory(
	storiesDir: string,
	name: string,
): Result<LoadedStory> {
	const storyDir = join(storiesDir, name);

	if (!existsSync(storyDir)) {
		return { ok: false, error: `Story not found: ${name}` };
	}

	// Load config
	const configPath = join(storyDir, "story.json");
	if (!existsSync(configPath)) {
		return { ok: false, error: `Missing story.json in ${name}` };
	}

	let config: StoryConfig;
	try {
		const raw = readFileSync(configPath, "utf-8");
		config = JSON.parse(raw) as StoryConfig;
	} catch {
		return { ok: false, error: `Invalid story.json in ${name}` };
	}

	// Load spec
	const specPath = join(storyDir, "spec.md");
	if (!existsSync(specPath)) {
		return { ok: false, error: `Missing spec.md in ${name}` };
	}
	const specContent = readFileSync(specPath, "utf-8");

	// Load test files
	const testFiles: Array<{ name: string; content: string }> = [];
	for (const testFile of config.testFiles) {
		const testPath = join(storyDir, testFile);
		if (existsSync(testPath)) {
			testFiles.push({
				name: testFile,
				content: readFileSync(testPath, "utf-8"),
			});
		}
	}

	return {
		ok: true,
		value: { config, specContent, testFiles, storyDir },
	};
}
