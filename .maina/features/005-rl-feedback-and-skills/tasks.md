# Task Breakdown

## Tasks

- [ ] T001: Write tests and implement feedback collector — wire into tryAIGenerate to record every AI interaction
- [ ] T002: Write tests and implement preference learning — track dismissed findings, write preferences.json
- [ ] T003: Enhance maina learn to propose improved prompts with A/B testing when accept rate drops
- [ ] T004: Write tests and implement episodic compression — accepted reviews become few-shot examples
- [ ] T005: Create skills package with 5 SKILL.md files using progressive disclosure
- [ ] T006: Test skills work in Claude Code context — verify metadata scanning and activation

## Dependencies

- T001 is independent (foundation)
- T002 is independent
- T003 depends on T001 (needs feedback data)
- T004 depends on T001 (needs feedback collector)
- T005 is independent (pure markdown)
- T006 depends on T005

## Definition of Done

- [ ] All tests pass
- [ ] Biome lint clean
- [ ] TypeScript compiles
- [ ] `maina learn` shows feedback from all task types
- [ ] Skills files exist with correct frontmatter and progressive disclosure
- [ ] Baseline comparison captured via `maina stats --compare`
