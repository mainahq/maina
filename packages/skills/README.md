# Maina Skills

[Agent Skills](https://agentskills.io/specification) that teach AI coding agents maina's v1 flows.

Each skill is a folder holding a `SKILL.md`. Its YAML front matter has only the fields the spec defines: `name` (the folder's name), `description` (what the skill does and when to use it, at most 1024 characters), `license`, `compatibility` and `metadata`. There are no trigger lists: hosts match a skill on its description, then read the body (under 5000 tokens) when it applies.

## Available Skills

| Skill | Description |
|-------|-------------|
| `gate` | Allow, ask or deny: what to do when the gate stops an action, and asking the policy first |
| `verify` | Run the verification pipeline, fix findings on changed lines, commit through maina, produce receipts |
| `spec` | Spec-first features: spec, plan and tasks kept consistent, then implemented test-first |
| `triage` | Two-stage review of a diff, triaged into blocking, advisory and info |
| `graph` | Impact (callers, dependents, covering tests) and minimal context from the code graph |

## Installation

Skills ship only two ways:

- **The maina plugin** for Claude Code, Cursor, Codex and Agent Plugins bundles every skill, with its CLI commands pointed at the launcher the plugin carries.
- **`maina setup`** copies every skill into `.agents/skills/<name>/SKILL.md` in your repo, where hosts that read Agent Skills discover them. It never overwrites a skill of the same name that maina did not write (one without `metadata.author: mainahq`).
