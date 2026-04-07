---
task: compile-architecture
tier: mechanical
version: 1
---

# Architecture Article Compilation

Given the following system overview:

Modules:
{module_list}

Module dependency graph:
{dependency_graph}

Community clusters (Louvain):
{communities}

Key decisions:
{key_decisions}

Cross-cutting concerns:
{cross_cutting}

Generate an architecture article that:
1. Provides a high-level overview of the system structure
2. Describes the module dependency graph and layering
3. Identifies community clusters and their purposes
4. Lists key architectural decisions that shaped the system
5. Notes cross-cutting concerns (error handling, logging, auth patterns)
6. Highlights potential architectural risks or debt

## Output Format

```markdown
# Architecture Overview

## System Structure
{high-level description of how the system is organized}

## Module Map
{list of modules with brief descriptions and layer assignments}

## Dependency Graph
{description of how modules depend on each other}

## Community Clusters
{groups of tightly-coupled modules with shared purpose}

## Key Decisions
{links to important architectural decisions}

## Cross-Cutting Concerns
{patterns that span multiple modules}

## Risks
{architectural debt or areas needing attention}
```
