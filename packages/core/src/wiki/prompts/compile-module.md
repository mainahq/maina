---
task: compile-module
tier: mechanical
version: 1
---

# Module Article Compilation

Given the following entities in module `{module_name}`:
{entity_list}

And the following dependency relationships:
{dependencies}

Generate a clear, concise module overview article that:
1. Describes what this module does in 1-2 sentences
2. Lists key entities grouped by purpose (exports, types, internal helpers)
3. Shows dependency relationships as a list of imports/exports
4. Notes which other modules depend on this one (consumers)
5. Links to related features and decisions using [[path]] notation

## Output Format

```markdown
# {module_name}

{one_line_description}

## Purpose
{2-3 sentences explaining the module's role in the system}

## Key Entities
{grouped list of functions, types, classes with brief descriptions}

## Dependencies
- **Imports from:** {list of modules this depends on}
- **Exported to:** {list of modules that import from this}

## Related
- Features: {links to feature articles}
- Decisions: {links to decision articles}
```
