# Feature: v1.0.0 — Launch

## Problem Statement

Maina is feature-complete (v0.7.0) but lacks community infrastructure, proper org structure, and a launch story. The repo is still under `beeeku/maina`, there's no CONTRIBUTING.md, and a known bug (#47) ships broken brainstorm output.

## Target User

- Primary: Developers discovering maina via Show HN / dev.to
- Secondary: Contributors who want to participate in the project

## User Stories

- As a new user, I want clear onboarding from mainahq.com so I can start using maina in 5 minutes.
- As a contributor, I want CONTRIBUTING.md and issue templates so I know how to participate.
- As a team lead, I want to find maina under a professional org (mainahq) with proper governance.

## Success Criteria

- [ ] Bug #47 fixed — `brainstorm --no-interactive` generates real content
- [ ] CONTRIBUTING.md with dev setup, PR guidelines, commit conventions
- [ ] Issue templates: bug report, feature request, question
- [ ] CODEOWNERS file mapping packages to maintainers
- [ ] GitHub Discussions enabled
- [ ] Repos transferred: beeeku/maina → mainahq/maina, beeeku/maina-cloud → mainahq/maina-cloud
- [ ] All internal links updated post-transfer
- [ ] Show HN draft written
- [ ] v1.0.0 changeset + npm publish

## Scope

### In Scope

- Fix bug #47 (brainstorm --no-interactive stubs)
- Community files: CONTRIBUTING.md, issue templates, CODEOWNERS, PR template
- Repo transfers to mainahq org
- Update all GitHub/npm references post-transfer
- Enable GitHub Discussions
- Show HN + dev.to draft
- Version bump to 1.0.0

### Out of Scope

- CF Workers skill (v1.1.0)
- Cross-dogfooding report (v1.1.0)
- New features — this is polish + launch only
