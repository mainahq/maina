# Maina Verify Action

A GitHub Actions composite action that runs the maina verification pipeline and posts results to the GitHub Step Summary.

## Usage

```yaml
- uses: actions/checkout@v4

- uses: mainahq/maina/.github/actions/verify@main
  with:
    base: main
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `base` | Base branch for diff comparison | `main` |
| `deep` | Enable standard-tier AI semantic review | `false` |

## What it does

1. Sets up Bun
2. Installs dependencies (`bun install --frozen-lockfile`)
3. Builds all packages (`bun run build`)
4. Runs `maina verify --json --base <base>` (adds `--deep` if enabled)
5. Posts a summary table to `$GITHUB_STEP_SUMMARY` with pass/fail status, finding count, and duration
6. Fails the step if verification fails

## Example: PR verification workflow

```yaml
name: Verify PR
on:
  pull_request:
    branches: [main, master]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: mainahq/maina/.github/actions/verify@main
        with:
          base: ${{ github.base_ref }}
```

## Example: Deep review on main

```yaml
name: Deep Verify
on:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: mainahq/maina/.github/actions/verify@main
        with:
          base: main
          deep: "true"
```
