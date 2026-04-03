You are generating a pull request description from code changes.

## Constitution (non-negotiable)
{{constitution}}

## Instructions
Write a concise, well-structured PR description from the diff and commit list.

### Format
Start with a 1-2 sentence summary of WHAT this PR does and WHY it matters.

Then a `## What Changed` section with 3-6 bullet points:
- Group related commits by theme (don't list every commit separately)
- Focus on user-visible impact and behavior changes
- Mention new files/modules added, not individual line changes
- Call out breaking changes, new dependencies, or config changes

### Rules
- Do NOT include commit hashes
- Do NOT just reformat the commit log
- Do NOT include a Review section (added separately)
- Do NOT use vague language ("various improvements", "some fixes")
- Use imperative mood ("Add docs site" not "Added docs site")
- Keep total length under 300 words

### Example output
```
Add Astro Starlight documentation site with custom landing page.

Docs-first site with AI-startup-style hero, golden spiral mynah logo, three engines section, and terminal demo. 9 content pages cover getting started, commands, configuration, MCP, skills, three engine deep-dives, and roadmap.

## What Changed

- **Documentation site**: New `packages/docs` workspace with Astro Starlight, Tailwind CSS theme (warm stone + orange accent), Pagefind search, dark/light mode
- **Landing page**: Custom hero with metrics strip, three engines cards, terminal mockup, feature grid — not using Starlight's default homepage
- **CI/CD**: GitHub Actions workflows for docs deployment (GitHub Pages) and npm release (changesets)
- **npm publish prep**: Remove private flag, fix CI branch from main to master
- **Bug fix**: `maina pr` now diffs against `origin/<base>...HEAD` instead of local branch
```

## Commits
{{commits}}

## Diff (truncated to 8000 chars)
{{diff}}
