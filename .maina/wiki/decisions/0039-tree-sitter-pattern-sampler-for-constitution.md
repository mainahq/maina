# Decision: Pattern sampler for constitution rules

> Status: **accepted**

## Context

Config files and git history capture explicit conventions, but coding style patterns (async/await vs .then, arrow vs declaration functions, named vs default imports) are implicit in the code itself. These need detection from code samples.

## Decision

Use regex-based pattern detection on sampled files (<=100 per language, deterministic selection). Regex is sufficient for the target patterns and avoids the complexity of tree-sitter AST parsing for V1.

Confidence scoring: prevalence ratio × 0.7 (capped). If 90% of async operations use await, confidence = 0.63. Medium-confidence rules require user confirmation.

## Rationale

### Positive
- Detects patterns that no config file captures
- Deterministic: same repo → same rules
- Fast: regex over 100 files takes <1s

### Negative
- Regex is less precise than AST for complex patterns (acceptable for V1)
- 100-file sample may miss patterns in large monorepos (mitigated by deterministic selection across directories)
