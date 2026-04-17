# Task Breakdown

## Tasks

- [ ] T1: Create `.github/workflows/release-sourcemaps.yml`
- [ ] T2: Enable sourcemap in build config if not already
- [ ] T3: Add version extraction step
- [ ] T4: maina verify + review

## Dependencies

- Depends on PostHog ADR (#89) for knowing where to upload

## Definition of Done

- [ ] Workflow runs on tag push
- [ ] Source maps generated alongside dist
- [ ] Version tag in workflow output matches package.json
