---
task: compile-entity
tier: mechanical
version: 1
---

# Entity Article Compilation

Given the following entity definition:
{entity_definition}

Located in module `{module_name}` at `{file_path}:{line_number}`:
{source_context}

With the following lifecycle context:
- Features that modified this entity: {features}
- Decisions that affect this entity: {decisions}
- Dependents (who uses this): {dependents}
- Dependencies (what this uses): {dependencies}

Generate an entity article that:
1. Describes what the entity is and what it does
2. Shows its type signature or interface
3. Lists which features introduced or modified it
4. References relevant architectural decisions
5. Notes breaking change risk based on dependent count

## Output Format

```markdown
# {entity_name}

**Kind:** {function|class|interface|type|const|enum}
**File:** `{file_path}:{line_number}`
**Module:** [[modules/{module_name}.md]]

## Description
{what this entity does and why it exists}

## Signature
```typescript
{type_signature_or_definition}
```

## Lifecycle
- Introduced by: [[features/{feature}.md]]
- Modified by: {list of feature links}
- Governed by: {list of decision links}

## Dependencies
- Uses: {list of entity links}
- Used by: {list of entity links}

## Change Risk
{low|medium|high} — {N} dependents
```
