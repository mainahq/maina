---
"@mainahq/core": minor
---

Add the gate's normalised events, classifier and rules engine (`packages/core/src/gate`). `GateEvent` normalises shell, file-write, outside-read, MCP and network actions across hosts; `classifyAction` says which action classes an event falls in — parsing shell with tree-sitter-bash (AST, not regex) so obfuscation via variables, quoting, wrappers, nesting, substitution and brace expansion is caught, plus a SQL classifier for destructive statements; and `evaluateRules(event, policy, ctx)` turns the classes and policy into `deny (final) / allow (listed) / ask / no_rule`, where a rule deny can never be loosened and irreversible classes ask unless explicitly allowed. The tree-sitter runtime loader is now shared between the code graph and the shell parser.
