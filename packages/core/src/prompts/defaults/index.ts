import { join } from "node:path";

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
	| "design-hld-lld";

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
	try {
		const filePath = join(import.meta.dir, `${task}.md`);
		const text = await Bun.file(filePath).text();
		return text;
	} catch {
		return FALLBACK_TEMPLATE;
	}
}
