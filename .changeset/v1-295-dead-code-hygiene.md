---
"@mainahq/core": major
---

Remove the Lighthouse and ZAP verify runners, which the pipeline never ran (ADR 0042). `runLighthouse`, `parseLighthouseJson`, `runZap`, `parseZapJson` and their option and result types are no longer exported from `@mainahq/core`, and `maina doctor` stops listing `lighthouse` and `zap` as optional tools. Unreachable modules were also deleted: the GitHub checks, slash-command and sticky-comment helpers, the constitution interview, pattern-sampler, config-parser and git-analyzer modules, SCIP ingest, symbol pages, wiki hooks, the cloud error reporter, and the unused agent prompt files. None of them were re-exported from the package entry point. The wiki decision extractor now skips an `adr/README.md` index.
