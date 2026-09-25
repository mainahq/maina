---
"@mainahq/mcp": minor
---

MCP prompts (FR-MCP-3): the server now serves three prompts. `review-changes` (`base`, `files`, `focus`) walks the agent through `impact`, `verify`, `review_triage` and `decide` and asks for a triaged report on the changed lines. `pre-merge` (`base`, `files`, `feature`, `receipt`) runs `status`, `verify`, `review_triage`, and `spec_check` / `receipt` when given paths, and ends in a READY TO MERGE or NOT READY TO MERGE verdict. `plan-feature` (`description`, required; `feature`) gathers code with `context` and `impact`, writes spec.md, plan.md and tasks.md and checks them with `spec_check`. A prompt is registered only when every tool it names is in the tool allow-list, so a prompt never points at a tool the server does not serve.
