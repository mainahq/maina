# Task Breakdown

## Tasks

- [x] T1: Write TDD test stubs (23 red confirmed)
- [x] T2: Implement `formatSignature()` — kind labels, export status
- [x] T3: Implement `formatLocation()` — file:line
- [x] T4: Implement `formatRefs()` — inbound/outbound, cap at 20
- [x] T5: Implement `formatMermaidDiagram()` — graph LR with arrow directions
- [x] T6: Implement `generateSymbolPage()` — combined (13 tests green)
- [x] T7: `maina verify` + `maina review` + `maina analyze`

## Dependencies

- Uses `CodeEntity` from `packages/core/src/wiki/extractors/code.ts`

## Definition of Done

- [ ] All tests pass (red → green)
- [ ] Biome lint + TypeScript clean
- [ ] maina verify + slop + review + analyze pass
- [ ] Mermaid diagrams render in GitHub markdown
