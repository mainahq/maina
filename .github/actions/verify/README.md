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
| `pr-comment` | Opt in to the PR receipt: one sticky comment and one `maina/receipt` check run | `false` |
| `github-token` | Token for the comment and check run (pull-requests + checks write) | `${{ github.token }}` |
| `comment-author` | Login whose sticky comment is updated; change it with a custom token | `github-actions[bot]` |
| `discovery-line` | Add the one-line "Verified by Maina" footer (the repo policy's `discovery.receipt_line: false` also turns it off) | `true` |
| `receipt-context` | JSON file with acceptance criteria, verify scope and gate counts | _(none)_ |

## PR receipt (opt-in)

With `pr-comment: "true"` on a `pull_request` run, the action builds a receipt
for the PR's changes and publishes it as **one** sticky comment and **one**
`maina/receipt` check run on the head commit. Both are updated in place on
every push, never duplicated. The comment shows each acceptance criterion with
its evidence, the verify scope and result, the review triage decision and its
confidence, the gate counts and overrides, and a link to the full receipt
(uploaded as the `maina-receipt` artifact).

Nothing is posted unless the repository sets `pr-comment`. On a fork PR the
workflow token is read-only, so the receipt is written to the job summary
instead, which shows on the PR through this job's own check run.

```yaml
permissions:
  contents: read
  pull-requests: write
  checks: write

steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  - uses: mainahq/maina/.github/actions/verify@main
    with:
      base: ${{ github.base_ref }}
      pr-comment: "true"
```

`receipt-context` takes the same fields as `maina receipt publish --context`:

```json
{
  "criteria": [
    { "id": "AC-1", "text": "Retries a 5xx", "status": "met", "evidence": ["tests: upload.test.ts:42"] }
  ],
  "gate": { "blocked": 1, "asked": 2, "allowed": 14, "overrides": [] }
}
```

A `url` in the context is the comment's "Full receipt" link; without one it
links the workflow run that uploaded the `maina-receipt` artifact.

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
