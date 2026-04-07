/**
 * Wiki State — manages .maina/wiki/.state.json for incremental compilation.
 *
 * Tracks SHA-256 hashes of source files and compiled articles to detect
 * what needs recompilation. State file is gitignored.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WikiState } from "./types";

const STATE_FILE = ".state.json";

// ─── Hashing ─────────────────────────────────────────────────────────────

export function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export function hashFile(filePath: string): string | null {
	try {
		const content = readFileSync(filePath, "utf-8");
		return hashContent(content);
	} catch {
		return null;
	}
}

// ─── State Factory ───────────────────────────────────────────────────────

export function createEmptyState(): WikiState {
	return {
		fileHashes: {},
		articleHashes: {},
		lastFullCompile: "",
		lastIncrementalCompile: "",
		compilationPromptHash: "",
	};
}

// ─── Persistence ─────────────────────────────────────────────────────────

export function loadState(wikiDir: string): WikiState | null {
	const statePath = join(wikiDir, STATE_FILE);
	if (!existsSync(statePath)) {
		return null;
	}
	try {
		const raw = readFileSync(statePath, "utf-8");
		return JSON.parse(raw) as WikiState;
	} catch {
		return null;
	}
}

export function saveState(wikiDir: string, state: WikiState): void {
	const statePath = join(wikiDir, STATE_FILE);
	writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// ─── Change Detection ────────────────────────────────────────────────────

/**
 * Compare previous file hashes with current to find changed, added, or deleted files.
 * Returns an array of file paths that need recompilation.
 */
export function getChangedFiles(
	previousHashes: Record<string, string>,
	currentHashes: Record<string, string>,
): string[] {
	const changed: string[] = [];

	// Check for new or modified files
	for (const [file, hash] of Object.entries(currentHashes)) {
		if (previousHashes[file] !== hash) {
			changed.push(file);
		}
	}

	// Check for deleted files
	for (const file of Object.keys(previousHashes)) {
		if (!(file in currentHashes)) {
			changed.push(file);
		}
	}

	return changed;
}
