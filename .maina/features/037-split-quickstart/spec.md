# Feature: Split /getting-started into /quickstart + /full-setup

## Problem Statement

The /getting-started page has 9 sections on one scroll. First-time users bounce before running their first `maina commit`. Time to first successful commit should be under 60 seconds.

## Success Criteria

- [x] `/quickstart` page exists, ≤200 words, 3 commands max
- [x] `/getting-started` renamed to `/full-setup` as reference
- [x] Hero CTA points to `/quickstart`
- [x] All internal links updated
- [x] Sidebar: Quickstart > Commands > Full Setup

## Scope

### In Scope
- New /quickstart page with 3 commands
- Rename /getting-started to /full-setup
- Update all nav/sidebar/internal links

### Out of Scope
- MCP badges on hero (separate issue #98)
- Docs number consistency (separate issue #99)
