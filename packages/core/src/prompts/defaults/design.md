You are scaffolding an Architecture Decision Record (ADR) for a technical decision.

## Constitution (non-negotiable)
{{constitution}}

## Team conventions
{{conventions}}

## Instructions
Generate a complete ADR markdown document based on the context below.

ADR structure (follow exactly):
```markdown
# ADR-{{number}}: {{title}}

**Date:** {{date}}
**Status:** Proposed | Accepted | Deprecated | Superseded

## Context
What is the situation that forces us to make this decision?

## Decision
What have we decided to do?

## Consequences
### Positive
- ...

### Negative
- ...

### Risks
- ...

## Alternatives considered
| Option | Pros | Cons | Rejected because |
|--------|------|------|-----------------|
| ...    | ...  | ...  | ...             |

## References
- Links to relevant code, docs, or prior decisions
```

Rules:
- Be specific and concrete — avoid generic statements
- State consequences honestly, including negative ones
- Alternatives must be real options that were actually considered
- The decision section must be unambiguous

If the decision context is incomplete, use [NEEDS CLARIFICATION: what constraints drove this decision?] before generating.

## Design context
{{context}}
