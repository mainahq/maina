---
"@mainahq/cli": patch
---

`maina setup` no longer makes the constitution AI call (host, cloud or BYOK) when `.maina/constitution.md` already exists. Setup keeps an existing constitution (only `--reset` regenerates it), so the generated text was thrown away. Re-runs, including repeated `maina setup --plugin` calls from host plugins, now spend no model quota, and a re-run no longer prints the degraded banner or appends to `.maina/setup.log`. The run reports `aiSource: "skipped"` in its result, the `--ci` JSON stream (`infer` phase `skipped`, reason `constitution_exists`) and setup telemetry, and it counts as neither tailored nor degraded.
