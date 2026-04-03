import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import { createCacheManager } from "@maina/core";
import { Command } from "commander";

export function cacheCommand(): Command {
	const cmd = new Command("cache").description("Cache management commands");

	cmd
		.command("stats")
		.description("Show cache hit rate, entries, and storage info")
		.action(() => {
			intro("maina cache stats");

			const repoRoot = process.cwd();
			const mainaDir = join(repoRoot, ".maina");

			const manager = createCacheManager(mainaDir);
			const stats = manager.stats();

			const hitRate =
				stats.totalQueries > 0
					? (
							((stats.l1Hits + stats.l2Hits) / stats.totalQueries) *
							100
						).toFixed(1)
					: "0.0";

			const lines = [
				`  ${"Metric".padEnd(20)} Value`,
				`  ${"─".repeat(20)} ${"─".repeat(12)}`,
				`  ${"Total queries".padEnd(20)} ${stats.totalQueries}`,
				`  ${"L1 hits (memory)".padEnd(20)} ${stats.l1Hits}`,
				`  ${"L2 hits (SQLite)".padEnd(20)} ${stats.l2Hits}`,
				`  ${"Misses".padEnd(20)} ${stats.misses}`,
				`  ${"Hit rate".padEnd(20)} ${hitRate}%`,
				`  ${"L1 entries".padEnd(20)} ${stats.entriesL1}`,
				`  ${"L2 entries".padEnd(20)} ${stats.entriesL2}`,
			];

			log.message(lines.join("\n"));

			// Check SQLite file size
			try {
				const dbPath = join(mainaDir, "cache", "cache.db");
				const file = Bun.file(dbPath);
				const size = file.size;
				const sizeStr =
					size < 1024
						? `${size} B`
						: size < 1024 * 1024
							? `${(size / 1024).toFixed(1)} KB`
							: `${(size / (1024 * 1024)).toFixed(1)} MB`;
				log.info(`Storage: ${sizeStr}`);
			} catch {
				log.info("Storage: N/A");
			}

			outro("Done.");
		});

	return cmd;
}
