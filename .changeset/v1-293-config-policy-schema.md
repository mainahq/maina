---
"@mainahq/core": minor
---

Validated config and policy schema (#293). `loadConfig(ports, root)` reads `.maina/config.json` through the fs port and returns a `Result` with every validation error and its path. `loadPolicy(ports, root, userDefault)` merges defaults < user < repo: a layer can tighten an irreversible action class but can only loosen it when the class is named in `explicitly_allow`. Both schemas are defined in zod, and `schemas/*.schema.json` is generated from them. The unenforced `budget.daily/perTask/alertAt` shape is replaced by `budget.dailyUsd/perTaskUsd/onBreach`. The 1.x `maina.config.ts` loader is now `loadConfigModule`: it validates and deep-merges the module, and maps the old budget keys onto the new ones.
