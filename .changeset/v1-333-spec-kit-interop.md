---
"@mainahq/core": minor
"@mainahq/cli": minor
---

Spec Kit interop. New `maina decide --type <t> [--json]` answers one decision with the gate's layered policy and prints a `{ data, error, meta }` envelope, so a Spec Kit workflow `shell` step can `switch` on `data.verdict` (exit 0 for every verdict; 3 for bad input or policy, 2 when the backend cannot answer). `maina analyze` reads Spec Kit features (`SPECIFY_FEATURE_DIRECTORY`, `.specify/feature.json`, then `specs/<branch>`; `--all` includes `specs/NNN-*`) through core's new `resolveSpecKitFeature` / `listSpecKitFeatures`, and the analyzer parses Spec Kit tasks (`- [ ] T001 [P] [US1] …` across `## Phase N` sections). `integrations/spec-kit/` adds a Spec Kit extension whose `pre_tool_use` event runs the Maina gate (failing closed to `ask`) and a `maina-gate` overlay for the stock `speckit` workflow.
