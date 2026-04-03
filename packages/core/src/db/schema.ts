import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const episodicEntries = sqliteTable("episodic_entries", {
	id: text("id").primaryKey(),
	content: text("content").notNull(),
	summary: text("summary"),
	relevance: real("relevance"),
	accessCount: integer("access_count"),
	createdAt: text("created_at").notNull(),
	lastAccessedAt: text("last_accessed_at"),
	type: text("type").notNull(),
});

export const semanticEntities = sqliteTable("semantic_entities", {
	id: text("id").primaryKey(),
	filePath: text("file_path").notNull(),
	name: text("name").notNull(),
	kind: text("kind", {
		enum: ["function", "class", "interface", "type", "variable"],
	}).notNull(),
	startLine: integer("start_line").notNull(),
	endLine: integer("end_line").notNull(),
	updatedAt: text("updated_at").notNull(),
});

export const dependencyEdges = sqliteTable("dependency_edges", {
	id: text("id").primaryKey(),
	sourceFile: text("source_file").notNull(),
	targetFile: text("target_file").notNull(),
	weight: real("weight"),
	type: text("type", { enum: ["import", "reference"] }).notNull(),
});

export const cacheEntries = sqliteTable("cache_entries", {
	id: text("id").primaryKey(),
	key: text("key").notNull().unique(),
	value: text("value").notNull(),
	promptVersion: text("prompt_version"),
	contextHash: text("context_hash"),
	model: text("model"),
	createdAt: text("created_at").notNull(),
	ttl: integer("ttl"),
});

export const feedback = sqliteTable("feedback", {
	id: text("id").primaryKey(),
	promptHash: text("prompt_hash").notNull(),
	command: text("command").notNull(),
	accepted: integer("accepted", { mode: "boolean" }).notNull(),
	context: text("context"),
	createdAt: text("created_at").notNull(),
});

export const promptVersions = sqliteTable("prompt_versions", {
	id: text("id").primaryKey(),
	task: text("task").notNull(),
	hash: text("hash").notNull(),
	content: text("content").notNull(),
	version: integer("version").notNull(),
	acceptRate: real("accept_rate"),
	usageCount: integer("usage_count"),
	createdAt: text("created_at").notNull(),
});
