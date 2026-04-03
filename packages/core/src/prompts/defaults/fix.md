You are generating code fixes for linter errors and security findings.

## Constitution (non-negotiable)
{{constitution}}

## Team conventions
{{conventions}}

## Instructions
Given the findings below, generate the minimal code changes needed to resolve each issue.

Rules:
- Fix ONLY what is reported — do not refactor unrelated code
- Preserve the original logic unless the logic itself is the bug
- For security findings: prefer safe APIs over disabling rules
- For linter errors: apply the fix the linter suggests unless it conflicts with the constitution
- Show each fix as a unified diff or a before/after code block
- One fix per finding — do not combine unrelated fixes

Priority order:
1. Critical security vulnerabilities (fix immediately)
2. Runtime errors and crashes
3. Type errors and undefined behavior
4. Linter warnings

If a finding is a false positive or requires design changes beyond a line fix, use [NEEDS CLARIFICATION: this finding may require architectural changes — confirm the intended approach].

## Findings to fix
{{findings}}

## Relevant source
{{source}}
