# Feature: Karpathy-Principled Spec Quality

## Problem Statement

Maina verifies code but not specs. A spec with vague language, unmeasurable criteria, or missing acceptance tests produces garbage implementation. "Garbage in, garbage out" — Karpathy's core insight about training data applies directly to specifications.

## Target User

- Primary: Developer writing specs via `maina plan` who needs measurable quality feedback
- Secondary: Team lead reviewing specs before implementation begins

## User Stories

- As a developer, I want spec quality scored 0-100 so I know when a spec is ready for implementation
- As a developer, I want to see when I skip verification so I can track my discipline
- As a developer, I want `maina spec` to verify test stubs actually fail before I implement
- As a developer, I want every plan task traced to test + code + commit so nothing falls through cracks

## Success Criteria

- [ ] `scoreSpec(specPath)` returns a quality score 0-100 with measurability, testability, ambiguity, completeness breakdown
- [ ] Specs scoring below 60 trigger a warning in `maina analyze`
- [ ] `maina commit --skip` events are tracked as discipline violations in stats.db with skip rate shown in `maina stats`
- [ ] `maina spec` auto-runs generated stubs and verifies all fail (red phase enforcement)
- [ ] `traceability(featureDir)` maps each plan task to its test file, implementation file, and commit
- [ ] `maina stats --specs` shows spec quality evolution over time

## Scope

### In Scope

- Spec quality scoring (deterministic, no AI)
- Skip event tracking in stats
- Red-green enforcement in maina spec
- Plan-to-code traceability checking
- Spec evolution metrics in maina stats

### Out of Scope

- AI-powered spec improvement suggestions (future — use learn command instead)
- Blocking commits on low spec scores (warning only)
- Cross-project spec comparison

## Design Decisions

- All checks are deterministic — no AI needed (Karpathy: "measure everything, trust nothing")
- Skip tracking is informational, not punitive — data helps developers self-improve
- Quality score uses verb analysis: measurable verbs (validates, returns, creates) score higher than vague verbs (handles, manages, supports)
