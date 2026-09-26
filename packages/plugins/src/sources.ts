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

type Result<T> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: string }>;

const PACKAGES_DIR = join(import.meta.dir, "..", "..");
const SKILLS_DIR = join(PACKAGES_DIR, "skills");
const LAUNCHER_DIR = join(PACKAGES_DIR, "runtime", "launcher");

/** The launcher files a plugin bundles; release keys are added at release. */
const LAUNCHER_FILES: readonly string[] = [
	"launch.sh",
	"launch.ps1",
	"manifest.json",
];

/** A semantic version, as every host's manifest schema wants it. */
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

const launcherFile = (name: string): GeneratedFile => {
	const path = join(LAUNCHER_DIR, name);
	return {
		path: name,
		content: readFileSync(path, "utf-8"),
		executable: (statSync(path).mode & 0o111) !== 0,
	};
};

const parseJson = (content: string): unknown => {
	try {
		return JSON.parse(content);
	} catch {
		return undefined;
	}
};

/**
 * The runtime version a launcher `manifest.json` pins. Pure. A manifest
 * without a semantic version is an error, never a default: a fallback would
 * publish every host package under a version no runtime has.
 */
export function pluginVersion(manifestContent: string): Result<string> {
	const manifest = parseJson(manifestContent);
	const version =
		typeof manifest === "object" && manifest !== null
			? (manifest as { version?: unknown }).version
			: undefined;
	return typeof version === "string" && SEMVER.test(version)
		? { ok: true, value: version }
		: {
				ok: false,
				error: `launcher/manifest.json pins no semantic version (got ${JSON.stringify(version)})`,
			};
}

export function loadSources(
	definition: PluginDefinition = PLUGIN,
): Result<Sources> {
	const launcher = LAUNCHER_FILES.map(launcherFile);
	const manifest = launcher.find((f) => f.path === "manifest.json");
	const version = pluginVersion(manifest?.content ?? "");
	if (!version.ok) return version;
	return {
		ok: true,
		value: {
			version: version.value,
			skills: definition.skills.map((name) => ({
				name,
				content: readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf-8"),
			})),
			launcher,
		},
	};
}
