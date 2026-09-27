---
"@mainahq/cli": minor
---

`maina digest --dogfood [--commit]`: writes the week that just ended (or `--week yyyy-ww`) as the dogfood report, `docs/dogfood/<yyyy-ww>.md`, from the decision log (`.maina/decisions.db`). The report holds counts and Maina's own labels, never commands or paths. `--commit` then commits that file alone (`git commit -- <file>`, other staged changes stay staged) as `docs: weekly dogfood report <yyyy-ww>`, and does nothing when the committed report is unchanged. It refuses to commit a week with no gate decisions (exit 1), because such a week does not count as a dogfood week. `--commit` without `--dogfood`, and `--dogfood` with `--send`, are rejected (exit 3). `--json` reports `{ week, digest, report: { path, committed } }`.
