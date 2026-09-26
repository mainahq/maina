/**
 * The files the generators package, read from the repo (the I/O edge of
 * `generate`): the skills from `packages/skills`, and the launcher from
 * `packages/runtime/launcher` (task 2.3). The plugin's version is the
 * runtime version the launcher pins, so a plugin release and the runtime it
 * installs move together.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN, type PluginDefinition } from "./definition";
import type { GeneratedFile, Sources } from "./generate";

const PACKAGES_DIR = join(import.meta.dir, "..", "..");
const SKILLS_DIR = join(PACKAGES_DIR, "skills");
const LAUNCHER_DIR = join(PACKAGES_DIR, "runtime", "launcher");

/** The launcher files a plugin bundles; release keys are added at release. */
const LAUNCHER_FILES: readonly string[] = [
	"launch.sh",
	"launch.ps1",
	"manifest.json",
];

const launcherFile = (name: string): GeneratedFile => {
	const path = join(LAUNCHER_DIR, name);
	return {
		path: name,
		content: readFileSync(path, "utf-8"),
		executable: (statSync(path).mode & 0o111) !== 0,
	};
};

export function loadSources(definition: PluginDefinition = PLUGIN): Sources {
	const launcher = LAUNCHER_FILES.map(launcherFile);
	const manifest = launcher.find((f) => f.path === "manifest.json");
	const version = (
		JSON.parse(manifest?.content ?? "{}") as { version?: unknown }
	).version;
	return {
		version: typeof version === "string" ? version : "0.0.0",
		skills: definition.skills.map((name) => ({
			name,
			content: readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf-8"),
		})),
		launcher,
	};
}
