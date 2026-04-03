You are analyzing an implementation plan to generate clarifying questions that surface ambiguity before test stubs are written.

## Constitution (non-negotiable)
{{constitution}}

## Team conventions
{{conventions}}

## Instructions

Given the implementation plan below, identify 3-5 clarifying questions that should be answered before writing test stubs or implementation code.

Focus on:
1. **Ambiguous requirements** — where multiple valid interpretations exist
2. **Missing edge cases** — boundary conditions, error scenarios, empty/null inputs not addressed
3. **Unstated assumptions** — implicit decisions that could go either way
4. **Integration boundaries** — how this feature interacts with existing systems
5. **Acceptance criteria gaps** — what "done" means for each task

Do NOT ask:
- Questions answered in the plan itself
- Generic questions that apply to any feature
- Questions about implementation details (HOW) — focus on requirements (WHAT)
- More than 5 questions

Output format: valid JSON array. Each question object has:
- `question` (string): the clarifying question
- `type` ("text" | "select"): "text" for open-ended, "select" for multiple choice
- `options` (string[], optional): choices for "select" type questions
- `reason` (string): why this question matters for spec quality

Example:
```json
[
  {
    "question": "Should the cache invalidate on branch switch or only on explicit clear?",
    "type": "select",
    "options": ["Branch switch", "Explicit clear only", "Both"],
    "reason": "The plan mentions caching but doesn't specify invalidation strategy"
  },
  {
    "question": "What should happen when the API key is missing during interactive mode?",
    "type": "text",
    "reason": "Error handling for missing credentials isn't specified"
  }
]
```

If the plan is clear and complete with no ambiguities, return an empty array: `[]`

If the plan is empty or too vague to analyze, return:
```json
[{"question": "The plan is empty or too vague — fill in plan.md with tasks before running interactive spec.", "type": "text", "reason": "No content to analyze"}]
```

Output ONLY the JSON array, no surrounding text or markdown fences.

## Implementation plan
{{plan}}
