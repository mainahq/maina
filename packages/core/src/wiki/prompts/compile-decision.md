---
task: compile-decision
tier: mechanical
version: 1
---

# Decision Article Compilation

Given the following decision record:
- ID: {decision_id}
- Title: {decision_title}
- Status: {status}

Context:
{context}

Decision:
{decision}

Rationale:
{rationale}

Alternatives rejected:
{alternatives_rejected}

Entities affected:
{entity_mentions}

Constitution alignment:
{constitution_alignment}

Generate a decision article that:
1. Clearly states the decision and its current status
2. Explains the context that motivated the decision
3. Documents the rationale with specific reasons
4. Lists alternatives that were considered and why they were rejected
5. Links to entities and modules affected by this decision
6. Notes alignment with project constitution

## Output Format

```markdown
# {decision_title}

**Status:** {proposed|accepted|deprecated|superseded}
**ID:** {decision_id}

## Context
{what problem or situation prompted this decision}

## Decision
{the actual decision made}

## Rationale
{why this decision was chosen over alternatives}

## Alternatives Considered
{list of rejected alternatives with reasons}

## Impact
- Entities affected: {links to entity articles}
- Modules affected: {links to module articles}

## Constitution Alignment
{how this decision aligns with project principles}
```
