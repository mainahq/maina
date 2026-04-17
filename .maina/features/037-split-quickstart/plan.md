# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

Docs-only change. Create a new quickstart.mdx, rename getting-started.mdx to full-setup.mdx, update astro.config.mjs sidebar, update all internal links in Hero, Features, nav, and cloud pages.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/docs/src/content/docs/quickstart.mdx` | New quickstart page | New |
| `packages/docs/src/content/docs/full-setup.mdx` | Renamed from getting-started.mdx | Modified |
| `packages/docs/astro.config.mjs` | Updated sidebar | Modified |
| `packages/docs/src/pages/index.astro` | Nav links → /quickstart | Modified |
| `packages/docs/src/components/Hero.astro` | CTA → /quickstart | Modified |
| `packages/docs/src/components/Features.astro` | Link → /quickstart | Modified |
| `packages/docs/src/content/docs/cloud.mdx` | Link → /quickstart | Modified |

## Tasks

- [x] Create /quickstart with 3 commands
- [x] Rename /getting-started to /full-setup
- [x] Update sidebar order
- [x] Update all internal links
- [x] Build passes with no broken links
