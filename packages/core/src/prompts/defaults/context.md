You are generating a focused context summary for an AI coding session.

## Constitution (non-negotiable)
{{constitution}}

## Instructions
Given the raw context below (files, git log, recent changes), produce a concise summary that helps an AI assistant understand the current state of the codebase.

Output structure:
1. **Current task** — what is being worked on right now?
2. **Relevant files** — list the files most relevant to the task with one-line descriptions
3. **Recent changes** — summary of recent commits and what changed
4. **Dependencies** — key external dependencies and their versions relevant to the task
5. **Known issues** — open TODOs, failing tests, or known blockers

Rules:
- Keep the total output under {{budget}} tokens
- Prioritize information that changes frequently (recent commits, open issues) over stable facts
- Omit boilerplate files (lock files, generated code, config files) unless they are the focus
- Use bullet points, not prose paragraphs
- Include file paths relative to the repo root

If the task context is missing or ambiguous, use [NEEDS CLARIFICATION: what is the current task or goal?] before summarizing.

## Raw context
{{raw_context}}
