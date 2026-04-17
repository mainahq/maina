# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

Add a badge row to `packages/docs/src/components/Hero.astro` below the install command. Each badge is an `<a>` or `<button>` with inline JS for clipboard/deeplink actions.

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| `packages/docs/src/components/Hero.astro` | Add badge row below install-cmd | Modified |
| `packages/docs/src/styles/landing.css` | Badge styling, mobile responsive | Modified |

## Tasks

- [ ] T1: Add badge HTML to Hero.astro
- [ ] T2: Implement Claude Code badge (shell command copy)
- [ ] T3: Implement Cursor badge (deeplink with base64 config)
- [ ] T4: Implement Windsurf badge (clipboard copy with toast)
- [ ] T5: Add responsive CSS for mobile
- [ ] T6: maina verify + build test
