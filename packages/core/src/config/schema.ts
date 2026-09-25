/**
 * Config schema (FR-GATE-9, spec §8). Zod is the single source of truth:
 * the TS types are inferred from it and `schemas/maina.config.schema.json`
 * is generated from it (`bun run schemas:generate`), so the three cannot
 * drift. See ADR 0043.
 */

import { z } from "zod";
import type { Result } from "../db/index";
import type { FsPort } from "../ports/fs";

/** Recursively readonly view of plain data. */
export type DeepReadonly<T> = T extends readonly (infer U)[]
	? readonly DeepReadonly<U>[]
	: T extends object
		? { readonly [K in keyof T]: DeepReadonly<T[K]> }
		: T;

// ── Shared validation helpers ───────────────────────────────────────────────

/** One schema violation: `path` is dotted (`budget.dailyUsd`, `rules.deny[0]`), `""` is the root. */
export type SchemaIssue = Readonly<{ path: string; message: string }>;

function formatPath(path: readonly PropertyKey[]): string {
	return path.reduce<string>((out, segment) => {
		if (typeof segment === "number") return `${out}[${segment}]`;
		const key = String(segment);
		return out === "" ? key : `${out}.${key}`;
	}, "");
}

function issueMessage(issue: z.core.$ZodIssue): string {
	if (issue.code === "invalid_key") {
		const reason = issue.issues[0]?.message;
		return reason ? `Invalid key: ${reason}` : issue.message;
	}
	return issue.message;
}

/** Every issue zod found, in document order, with a printable path. */
export function toSchemaIssues(error: z.ZodError): readonly SchemaIssue[] {
	return error.issues.map((issue) => ({
		path: formatPath(issue.path),
		message: issueMessage(issue),
	}));
}

type JsonFileError = Readonly<{
	kind: "parse" | "io";
	message: string;
}>;

/**
 * Reads and parses a JSON file through the fs port. A missing file is not an
 * error: it resolves to `undefined` so callers fall back to their defaults.
 */
export async function readJsonFile(
	fs: FsPort,
	path: string,
): Promise<Result<unknown, JsonFileError>> {
	const read = await fs.readFile(path);
	if (!read.ok) {
		return read.error.kind === "not_found"
			? { ok: true, value: undefined }
			: { ok: false, error: { kind: "io", message: read.error.message } };
	}
	try {
		return { ok: true, value: JSON.parse(read.value) as unknown };
	} catch (error) {
		return {
			ok: false,
			error: {
				kind: "parse",
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

/** Stable on-disk rendering of a generated JSON Schema. */
export function renderJsonSchema(schema: unknown): string {
	return `${JSON.stringify(schema, null, "\t")}\n`;
}

/** Undefined-valued keys removed, so spreading a layer never erases a base value. */
export function defined<T extends object>(
	value: T | undefined,
): Partial<{ [K in keyof T]: Exclude<T[K], undefined> }> {
	return Object.fromEntries(
		Object.entries(value ?? {}).filter(([, v]) => v !== undefined),
	) as Partial<{ [K in keyof T]: Exclude<T[K], undefined> }>;
}

// ── Config schema ───────────────────────────────────────────────────────────

const modelId = z.string().min(1);

const ModelsSchema = z.strictObject({
	mechanical: modelId.describe(
		"Cheap, fast tier: commit messages, tests, slop detection, compression.",
	),
	standard: modelId.describe("Mid tier: reviews, plans, design docs."),
	architectural: modelId.describe(
		"Top tier: design review, architecture, prompt evolution.",
	),
	local: modelId.describe("Offline tier."),
});

const usd = z.number().nonnegative().nullable();

const BudgetSchema = z.strictObject({
	dailyUsd: usd.describe(
		"Spend cap per UTC day in US dollars. null disables the cap.",
	),
	perTaskUsd: usd.describe(
		"Spend cap for a single command in US dollars. null disables the cap.",
	),
	onBreach: z
		.enum(["degrade", "stop"])
		.describe(
			"What happens when a cap is reached: degrade to the lower tier, or stop with a message.",
		),
});

const RepoAliasesSchema = z
	.record(
		z.string().min(1),
		z.string().regex(/^[^/\s]+\/[^/\s]+$/, "Expected an owner/repo slug"),
	)
	.describe("Short names for GitHub repositories, used by `maina ticket`.");

const TelemetrySchema = z
	.boolean()
	.describe(
		"1.x setup telemetry opt-out (false opts out). Superseded by policy.telemetry.",
	);

const ConfigSchema = z.strictObject({
	models: ModelsSchema,
	provider: z.string().min(1),
	budget: BudgetSchema,
	repoAliases: RepoAliasesSchema,
	telemetry: TelemetrySchema.optional(),
});

/** The resolved config: defaults with every layer merged on top. */
export type Config = DeepReadonly<z.infer<typeof ConfigSchema>>;

const ConfigFileSchema = z
	.strictObject({
		$schema: z.string().optional(),
		models: ModelsSchema.partial().optional(),
		provider: z
			.string()
			.min(1)
			.describe("AI provider: openrouter, anthropic, ...")
			.optional(),
		budget: BudgetSchema.partial().optional(),
		repoAliases: RepoAliasesSchema.optional(),
		telemetry: TelemetrySchema.optional(),
	})
	.meta({
		title: "Maina config",
		description: "Project configuration read from .maina/config.json.",
	});

/** What one config file may contain: every key optional. */
export type ConfigLayer = DeepReadonly<z.infer<typeof ConfigFileSchema>>;

export type ConfigError = Readonly<{
	kind: "invalid" | "parse" | "io";
	/** Absolute path of the offending file. */
	file: string;
	/** Dotted path inside the file; `""` for the root or a whole-file error. */
	path: string;
	message: string;
}>;

/** Validates one config layer and reports every violation, not just the first. */
export function parseConfigLayer(
	raw: unknown,
	file: string,
): Result<ConfigLayer, readonly ConfigError[]> {
	const parsed = ConfigFileSchema.safeParse(raw);
	if (parsed.success) return { ok: true, value: parsed.data };
	return {
		ok: false,
		error: toSchemaIssues(parsed.error).map((issue) => ({
			kind: "invalid",
			file,
			...issue,
		})),
	};
}

/**
 * The defined merge: scalars from the layer replace the base, nested objects
 * merge key by key, and keys the layer leaves out keep the base value.
 */
export function mergeConfig(base: Config, layer: ConfigLayer): Config {
	const { $schema: _schema, models, budget, repoAliases, ...scalars } = layer;
	return {
		...base,
		...defined(scalars),
		models: { ...base.models, ...defined(models) },
		budget: { ...base.budget, ...defined(budget) },
		repoAliases: { ...base.repoAliases, ...repoAliases },
	};
}

/** JSON Schema for `.maina/config.json`, generated from the zod schema. */
export function configJsonSchema(): Readonly<Record<string, unknown>> {
	return z.toJSONSchema(ConfigFileSchema, { io: "input" });
}
