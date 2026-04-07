---
task: compile-feature
tier: mechanical
version: 1
---

# Feature Article Compilation

Given the following feature metadata:
- ID: {feature_id}
- Title: {feature_title}
- Branch: {branch}
- PR: {pr_number}
- Merged: {merged}

Spec quality score: {spec_quality_score}
Spec assertions: {spec_assertions}

Tasks:
{task_list}

Entities modified:
{entities_modified}

Decisions created:
{decisions_created}

Generate a feature history article that:
1. Summarizes what the feature does
2. Lists acceptance criteria from the spec
3. Shows implementation progress (completed tasks vs total)
4. Links to entities that were added or modified
5. Links to decisions that were made during implementation
6. Notes the branch and PR for traceability

## Output Format

```markdown
# {feature_title}

**Feature:** {feature_id}
**Status:** {merged|in-progress|planned}
**Branch:** `{branch}`
**PR:** #{pr_number}

## Summary
{what this feature does and why}

## Acceptance Criteria
{list of spec assertions}

## Implementation
{task_list with completion status}

## Entities Modified
{links to entity articles}

## Decisions
{links to decision articles created during this feature}
```
