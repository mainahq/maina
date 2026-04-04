# @maina/core

Core engines for the Maina verification-first developer OS.

Three engines: **Context** (observes), **Prompt** (learns), **Verify** (verifies).

## Features

- **Context Engine** — 4-layer retrieval (Working, Episodic, Semantic, Retrieval) with PageRank relevance and dynamic token budget
- **Prompt Engine** — Constitution + custom prompts + A/B testing + feedback-driven evolution
- **Verify Engine** — 12-tool pipeline (Biome, Semgrep, Trivy, Secretlint, SonarQube, Stryker, diff-cover, AI review, slop detection, visual regression) with diff-only filtering
- **Multi-language** — TypeScript, Python, Go, Rust with language-specific profiles
- **Workflow context** — rolling summary forwarded between lifecycle steps
- **Background RL** — async feedback recording at each workflow step

## Usage

```typescript
import { runPipeline, detectLanguages, tryAIGenerate } from "@maina/core";

const result = await runPipeline({ cwd: ".", diffOnly: true });
console.log(result.passed ? "Clean" : `${result.findings.length} findings`);
```

## License

Apache-2.0
