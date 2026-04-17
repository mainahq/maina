# Feature: Implementation Plan

## Scope

### In Scope - Symbol page template generator in wiki compiler - Mermaid diagram generation from entity refs - Deterministic output (same entity → same page) ### Out of Scope - LLM-generated prose descriptions (future — needs AI integration) - Interactive graph navigation (future — needs frontend)

## Tasks

Progress: 7/7 (100%)

- [x] T1: Write TDD test stubs (23 red confirmed)
- [x] T2: Implement `formatSignature()` — kind labels, export status
- [x] T3: Implement `formatLocation()` — file:line
- [x] T4: Implement `formatRefs()` — inbound/outbound, cap at 20
- [x] T5: Implement `formatMermaidDiagram()` — graph LR with arrow directions
- [x] T6: Implement `generateSymbolPage()` — combined (13 tests green)
- [x] T7: `maina verify` + `maina review` + `maina analyze`

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
