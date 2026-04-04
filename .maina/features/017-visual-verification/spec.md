# Feature 017: Visual Verification with Playwright

## Problem

Maina verifies code correctness (linting, tests, slop, AI review) but has no way to verify visual correctness for web projects. Code can pass every gate and still produce broken layouts, missing elements, or wrong colors. This is the last major gap — functional verification without visual verification.

## Success Criteria

- **SC-1:** `detectWebProject(cwd)` returns true when package.json has a dev server script (next dev, astro dev, vite, etc.)
- **SC-2:** `captureScreenshots(urls, options)` takes screenshots via Playwright and saves to `.maina/visual-baselines/`
- **SC-3:** `compareScreenshots(baseline, current)` returns pixel diff percentage and produces a diff image
- **SC-4:** Visual diff findings integrate as `Finding[]` with `tool: "visual"` in the pipeline
- **SC-5:** `maina verify --visual` triggers visual verification (opt-in, not default — too slow for every commit)
- **SC-6:** Configurable diff threshold in `.maina/preferences.json` (default: 0.1% = 0.001)
- **SC-7:** Baseline management: `maina visual update` saves current screenshots as new baselines
- **SC-8:** Works headless (CI) and headed (local dev)

## Out of Scope

- Playwright MCP server integration (use Playwright directly via Bun.spawn, not MCP)
- Component-level visual testing (full-page screenshots only)
- Cross-browser testing (Chromium only for v1)
- Responsive testing (single viewport for v1: 1280x720)
- Automatic dev server startup (user must have server running)

## Design

### Architecture

New module: `packages/core/src/verify/visual.ts`

Three functions:
1. `detectWebProject(cwd)` — checks package.json for dev server scripts
2. `captureScreenshots(urls, options)` — spawns `npx playwright screenshot` for each URL
3. `compareScreenshots(baselineDir, currentDir)` — pixel comparison using `pixelmatch` (pure JS, no native deps)

### Screenshot Capture

Uses Playwright CLI (not the MCP server) via `Bun.spawn`:
```
npx playwright screenshot --browser chromium --viewport-size 1280,720 <url> <output.png>
```

Falls back gracefully if Playwright is not installed (`npx playwright` will fail → skip with warning).

### Pixel Comparison

Uses `pixelmatch` npm package — pure JavaScript pixel-by-pixel comparison. Returns:
- `diffPixels: number` — count of different pixels
- `diffPercentage: number` — percentage of total pixels that differ
- `diffImage: Buffer` — PNG image highlighting differences

### Baseline Management

```
.maina/visual-baselines/
├── homepage.png
├── about.png
└── dashboard.png
```

- `maina visual update` captures current screenshots and saves as baselines
- `maina verify --visual` compares current against baselines
- Baselines are committed to git (they're the "source of truth" for visual state)

### Pipeline Integration

`PipelineOptions` gains `visual?: boolean`. When true:
1. Detect web project
2. Capture screenshots of configured URLs
3. Compare against baselines
4. Each page exceeding threshold → `Finding` with `tool: "visual"`, `severity: "warning"`

### Configuration

In `.maina/preferences.json`:
```json
{
  "visual": {
    "urls": ["http://localhost:3000", "http://localhost:3000/about"],
    "threshold": 0.001,
    "viewport": { "width": 1280, "height": 720 }
  }
}
```

### Tool Registry

Add `"playwright"` to tool registry in detect.ts.

## Files to Change

| File | Change |
|------|--------|
| `packages/core/src/verify/visual.ts` | NEW — detectWebProject, captureScreenshots, compareScreenshots |
| `packages/core/src/verify/__tests__/visual.test.ts` | NEW — tests |
| `packages/core/src/verify/detect.ts` | Add playwright to registry |
| `packages/core/src/verify/pipeline.ts` | Add visual option, wire visual verification |
| `packages/cli/src/commands/verify.ts` | Add --visual flag |
| `packages/cli/src/commands/visual.ts` | NEW — `maina visual update` command |
| `packages/cli/src/program.ts` | Register visual command |
| `packages/core/src/index.ts` | Export visual module |
