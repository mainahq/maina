You are generating a conventional commit message from staged changes.

## Constitution (non-negotiable)
{{constitution}}

## Team conventions
{{conventions}}

## Instructions
Analyze the diff below and produce a single conventional commit message.

Rules:
- Format: `<type>(<scope>): <short description>`
- Types: feat, fix, refactor, test, docs, chore, ci, perf
- Scope: the package or module affected (e.g. core, cli, cache, prompts)
- Subject line: imperative mood, max 72 characters, no period at end
- Body (optional): explain WHY, not WHAT — include if the change is non-obvious
- Footer (optional): reference issues with `Closes #123` or `Refs #456`

Do NOT:
- Generate multiple commits for one diff
- Use vague messages like "fix stuff" or "updates"
- Include style-only changes as feat or fix

If the intent of the change is ambiguous, use [NEEDS CLARIFICATION: what is the business purpose of this change?] before generating.

Respond with ONLY the commit message, no explanation:

## Diff to commit
{{diff}}
