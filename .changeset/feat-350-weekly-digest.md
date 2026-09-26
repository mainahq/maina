---
"@mainahq/core": minor
"@mainahq/cli": minor
---

Weekly digest: `maina digest [--week yyyy-ww] [--send] [--card-labels] [--json]`. It reports what the gate did over one ISO week, read from the decision log (`.maina/decisions.db`): blocked, asked and allowed counts, deny and ask rates, overrides, volume per gated event kind and the top blocked action classes. It also prints a short card that is safe to share, with numbers and Maina's own action class names only. Code, paths and repository names never reach the card unless `--card-labels` is given. Nothing is delivered unless you pass `--send` and the new `digest` section of `.maina/config.json` names a channel: an https `webhook.url`, which receives `{ "text": <card> }`, or `email.to` recipients, which get the card through the local `sendmail -t`. Only the card is sent. The metrics and the markdown now live in `@mainahq/core` (`buildDigest`, `renderDigest`, `renderDigestCard`, `deliverDigest`). The repo's dogfood report is a thin caller of them, and a golden test pins its output byte for byte.
