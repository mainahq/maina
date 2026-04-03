# Task Breakdown

## Tasks

- [ ] T001: Write tests and implement spec quality scoring in packages/core/src/features/quality.ts
- [ ] T002: Write tests and implement skip event tracking in stats/tracker.ts
- [ ] T003: Add red-green enforcement to maina spec — auto-run stubs and verify all fail
- [ ] T004: Write tests and implement plan-to-code traceability in packages/core/src/features/traceability.ts
- [ ] T005: Add --specs flag to maina stats showing spec quality evolution over time

## Dependencies

- T001 is independent (foundation)
- T002 is independent
- T003 is independent
- T004 is independent
- T005 depends on T001 (needs spec scores to display)

## Definition of Done

- [ ] All tests pass
- [ ] Biome lint clean
- [ ] TypeScript compiles
- [ ] `maina stats --specs` shows quality data
- [ ] Skip rate visible in `maina stats`
- [ ] `maina spec` verifies stubs fail
