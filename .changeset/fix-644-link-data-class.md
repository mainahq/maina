---
"@mainahq/cli": patch
---

`maina cloud enrol` now asks Maina Cloud for your org's data class and keeps it. `maina cloud status` and `maina cloud privacy` show that class. If the cloud sends none, the device stays at `metadata`. The vendored Link protocol is re-pinned to the cloud's current manifest. The refusal codes the runtime acts on now come from the protocol's published `refusal.schema.json`.
