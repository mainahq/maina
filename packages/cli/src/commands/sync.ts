/**
 * `maina sync push` — Upload local prompts to maina cloud.
 * `maina sync pull` — Download team prompts from maina cloud.
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import type { PromptRecord } from "@mainahq/core";
import { createCloudClient, loadAuthConfig } from "@mainahq/core";
import { Command } from "commander";

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_CLOUD_URL =
	process.env.MAINA_CLOUD_URL ?? "https://api.maina.dev";

// ── Helpers ─────────────────────────────────────────────────────────────────

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function loadLocalPrompts(promptsDir: string): PromptRecord[] {
	if (!existsSync(promptsDir)) {
		return [];
	}

	const files = readdirSync(promptsDir).filter((f) => f.endsWith(".md"));
	return files.map((file) => {
		const filePath = join(promptsDir, file);
		const content = readFileSync(filePath, "utf-8");
		return {
			id: file.replace(/\.md$/, ""),
			path: file,
			content,
			hash: hashContent(content),
			updatedAt: new Date().toISOString(),
		};
	});
}

// ── Push Action ─────────────────────────────────────────────────────────────

export interface SyncActionResult {
	synced: boolean;
	count: number;
	reason?: string;
}

export async function syncPushAction(cwd?: string): Promise<SyncActionResult> {
	const root = cwd ?? process.cwd();
	const promptsDir = join(root, ".maina", "prompts");

	const authResult = loadAuthConfig();
	if (!authResult.ok) {
		return { synced: false, count: 0, reason: authResult.error };
	}

	const prompts = loadLocalPrompts(promptsDir);
	if (prompts.length === 0) {
		return {
			synced: false,
			count: 0,
			reason: "No prompts found in .maina/prompts/",
		};
	}

	const client = createCloudClient({
		baseUrl: DEFAULT_CLOUD_URL,
		token: authResult.value.accessToken,
	});

	const result = await client.putPrompts(prompts);
	if (!result.ok) {
		return { synced: false, count: 0, reason: result.error };
	}

	return { synced: true, count: prompts.length };
}

// ── Pull Action ─────────────────────────────────────────────────────────────

export async function syncPullAction(cwd?: string): Promise<SyncActionResult> {
	const root = cwd ?? process.cwd();
	const promptsDir = join(root, ".maina", "prompts");

	const authResult = loadAuthConfig();
	if (!authResult.ok) {
		return { synced: false, count: 0, reason: authResult.error };
	}

	const client = createCloudClient({
		baseUrl: DEFAULT_CLOUD_URL,
		token: authResult.value.accessToken,
	});

	const result = await client.getPrompts();
	if (!result.ok) {
		return { synced: false, count: 0, reason: result.error };
	}

	const prompts = result.value;
	if (prompts.length === 0) {
		return { synced: true, count: 0 };
	}

	mkdirSync(promptsDir, { recursive: true });

	for (const prompt of prompts) {
		const filePath = join(promptsDir, prompt.path);
		writeFileSync(filePath, prompt.content, "utf-8");
	}

	return { synced: true, count: prompts.length };
}

// ── Commander Command ───────────────────────────────────────────────────────

export function syncCommand(): Command {
	const cmd = new Command("sync").description("Sync prompts with maina cloud");

	cmd
		.command("push")
		.description("Upload local prompts to the cloud")
		.action(async () => {
			intro("maina sync push");

			const s = spinner();
			s.start("Uploading prompts...");

			const result = await syncPushAction();

			if (result.synced) {
				s.stop("Done");
				log.success(`Pushed ${result.count} prompt(s) to cloud.`);
				outro("Sync complete.");
			} else {
				s.stop("Failed");
				log.error(result.reason ?? "Unknown error");
				outro("Sync failed.");
			}
		});

	cmd
		.command("pull")
		.description("Download team prompts from the cloud")
		.action(async () => {
			intro("maina sync pull");

			const s = spinner();
			s.start("Downloading prompts...");

			const result = await syncPullAction();

			if (result.synced) {
				s.stop("Done");
				log.success(`Pulled ${result.count} prompt(s) from cloud.`);
				outro("Sync complete.");
			} else {
				s.stop("Failed");
				log.error(result.reason ?? "Unknown error");
				outro("Sync failed.");
			}
		});

	return cmd;
}
