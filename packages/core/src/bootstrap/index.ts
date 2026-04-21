/**
 * Bootstrap — shared scaffolding path used by `init` and `setup`.
 *
 * Exposes a single `scaffold()` function that writes the static `.maina/`
 * skeleton. Tailored files (constitution bodies, agent files, IDE MCP
 * configs) are layered on top by higher-level modules.
 */

export {
	COMMIT_PROMPT_TEMPLATE,
	CONFIG_YML_STUB,
	CONSTITUTION_STUB,
	REVIEW_PROMPT_TEMPLATE,
	type ScaffoldOptions,
	type ScaffoldReport,
	scaffold,
} from "./scaffold";
