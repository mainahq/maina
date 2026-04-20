# Feature: maina wiki export for Cypher, GraphML, and Obsidian

> Tracking issue: [#202](https://github.com/mainahq/maina/issues/202)

## Problem

The knowledge graph is locked inside our markdown + state format. Users who already run Neo4j, Gephi/yEd, or Obsidian cannot incorporate Maina's graph into their existing tools without hand-rolling serializers.

## Why it matters

- Interop drives adoption. Being a good graph citizen is cheaper than trying to replace users' existing tools.
- Download-format telemetry tells us which hosted view to prioritize in maina-cloud.
- Unlocks the 'Obsidian-native dev wiki' narrative at zero marginal infra cost — we already emit `[[wikilinks]]`.

## Success criteria

- [ ] `packages/core/src/wiki/export.ts` exports `exportGraph(graph, articles, format): Result<string | Record<string,string>, string>` supporting formats: `'cypher' | 'graphml' | 'obsidian'`.
- [ ] Cypher: emits `CREATE` statements for nodes + relationships, round-trippable in Neo4j 5.x; nodes carry id/type/label/pageRank; relationships carry type/weight.
- [ ] GraphML: valid XML, opens in Gephi 0.10 and yEd latest without warnings; node/edge attributes typed.
- [ ] Obsidian: directory of `.md` files with frontmatter and `[[wikilinks]]`, plus `.obsidian/workspace.json` minimal config; drag-into-Obsidian works.
- [ ] CLI: `maina wiki export <format> --out <path>` (defaults `out=./maina-export-<format>`).
- [ ] Each format has a golden-file test.
- [ ] `maina verify` passes.

## Scope

### In Scope
- `export.ts` + three exporters + tests.
- New CLI subcommand under `packages/cli/src/commands/wiki/`.
- Docs page in `packages/docs/`.

### Out of Scope
- Import direction (Cypher → Maina, etc.).
- Live streaming/incremental export.
- Additional formats (GEXF, JSON-LD) — pick up in a follow-up if users ask.

## Notes

- Keep serializers pure functions over `KnowledgeGraph`; do not depend on compiler state.
- Obsidian exporter should symlink or copy, not duplicate, existing wiki/ markdown where possible.
