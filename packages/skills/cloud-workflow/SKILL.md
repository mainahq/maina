---
name: cloud-workflow
description: Use maina cloud for team prompt sync, hosted verification, and feedback-driven learning.
triggers:
  - "cloud verification"
  - "sync prompts"
  - "team setup"
  - "hosted verify"
  - "maina cloud"
  - "share prompts"
---

# Cloud Workflow

## When to use

When working in a team, when you want hosted verification without installing tools locally, or when you want prompts and feedback to sync across team members. Cloud is optional -- all maina commands work offline.

## Steps

1. **Authenticate** with `maina login`. This opens a browser-based OAuth device flow (same as GitHub CLI). Your token is stored at `~/.maina/auth.json`.
2. **Share prompts** across your team:
   - `maina sync push` uploads your local `.maina/prompts/` to the team.
   - `maina sync pull` downloads the team's prompts and merges with your local copies.
   - Prompts are content-hashed -- only changed prompts are transferred.
3. **Run hosted verification** with `maina verify --cloud`. Your diff is submitted to Maina Cloud, the full 18-tool pipeline runs on cloud workers, and results stream back to your terminal. No local tool installs required.
4. **Learn from team feedback** with `maina learn --cloud`. This uploads your local feedback events, fetches team-wide improvement suggestions, and shows which prompts are healthy vs need attention.
5. **Manage your team** with `maina team` to view members and `maina team invite <email>` to add new members.
6. **CI integration:** Add cloud verification to GitHub Actions:
   ```yaml
   - uses: mainahq/maina/.github/actions/verify@main
     with:
       token: ${{ secrets.MAINA_TOKEN }}
   ```

## Example

```bash
# One-time setup
maina login
# Opens browser: enter code ABCD-1234

# Share your prompts with the team
maina sync push
# Uploaded 3 prompts (2 new, 1 updated)

# Pull team prompts
maina sync pull
# Downloaded 5 prompts (3 new, 0 conflicts)

# Verify in the cloud
maina verify --cloud
# Submitted diff (42 lines). Waiting...
# [syntax]   PASS  (cloud)
# [semgrep]  PASS  (cloud)
# [trivy]    PASS  (cloud)
# All checks passed. Proof: https://api.mainahq.com/proof/abc123

# Learn from team patterns
maina learn --cloud
# Uploaded 12 feedback events
# Team accept rate: 87% (commit: 92%, review: 78%)
# Suggestion: review prompt needs improvement (accept rate below 80%)
```

## Notes

- Your code is never uploaded to Maina Cloud. Only prompts, feedback signals, and compressed summaries are synced. Diffs are submitted only with `verify --cloud`.
- Feedback events are auto-synced on every command when logged in. No manual upload needed.
- Episodic entries (compressed review summaries) are shared across the team automatically and merged into each member's context engine with deduplication.
- Use `maina logout` to clear stored credentials.
- Set `MAINA_CLOUD_URL` for self-hosted instances.
- All commands are available as both CLI (`maina <command>` or `npx @mainahq/cli <command>`) and MCP tools when running inside an AI coding tool.
