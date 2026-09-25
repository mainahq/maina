/// <reference path="../../text-assets.d.ts" />
// Templates are imported as text so the compiled package inlines them: the
// published `dist/` has no `.md` files next to the bundle (#294). The
// reference keeps the `*.md` typing when another package type-checks core.
import aiReview from "./ai-review.md" with { type: "text" };
import commit from "./commit.md" with { type: "text" };
import context from "./context.md" with { type: "text" };
import design from "./design.md" with { type: "text" };
import designApproaches from "./design-approaches.md" with { type: "text" };
import designHldLld from "./design-hld-lld.md" with { type: "text" };
import explain from "./explain.md" with { type: "text" };
import fix from "./fix.md" with { type: "text" };
import review from "./review.md" with { type: "text" };
import specQuestions from "./spec-questions.md" with { type: "text" };
import tests from "./tests.md" with { type: "text" };
import walkthrough from "./walkthrough.md" with { type: "text" };
import wikiCompile from "./wiki-compile.md" with { type: "text" };
import wikiQuery from "./wiki-query.md" with { type: "text" };

export type PromptTask =
	| "review"
	| "commit"
	| "tests"
	| "fix"
	| "explain"
	| "design"
	| "context"
	| "spec-questions"
	| "design-approaches"
	| "ai-review"
	| "design-hld-lld"
	| "wiki-query"
	| "wiki-compile"
	| "walkthrough";

const DEFAULTS: Readonly<Record<PromptTask, string>> = {
	review,
	commit,
	tests,
	fix,
	explain,
	design,
	context,
	"spec-questions": specQuestions,
	"design-approaches": designApproaches,
	"ai-review": aiReview,
	"design-hld-lld": designHldLld,
	"wiki-query": wikiQuery,
	"wiki-compile": wikiCompile,
	walkthrough,
};

const FALLBACK_TEMPLATE = `You are a helpful AI assistant completing the "{{task}}" task.

## Constitution (non-negotiable)
{{constitution}}

## Instructions
Complete the requested task based on the input provided below.

If anything is ambiguous, use [NEEDS CLARIFICATION: specific question] instead of guessing.

## Input
{{input}}
`;

export async function loadDefault(task: PromptTask): Promise<string> {
	return DEFAULTS[task] ?? FALLBACK_TEMPLATE;
}
