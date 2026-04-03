You are proposing architectural approaches for a design decision, with tradeoffs and a recommendation.

## Constitution (non-negotiable)
{{constitution}}

## Team conventions
{{conventions}}

## Instructions

Given the design context below, propose 2-3 distinct approaches to the architectural decision.

For each approach, provide:
1. **Name** — a short descriptive label (2-4 words)
2. **Description** — how this approach works (2-3 sentences)
3. **Pros** — concrete advantages (2-3 bullet points)
4. **Cons** — concrete disadvantages (2-3 bullet points)
5. **Recommendation** — boolean, true for at most one approach

Rules:
- Approaches must be genuinely different, not minor variations
- Pros and cons must be specific to this decision, not generic
- Exactly one approach should be recommended with reasoning
- Consider: complexity, performance, maintainability, alignment with existing architecture
- If the context is too vague to propose meaningful approaches, return an empty array

Output format: valid JSON array. Each approach object has:
- `name` (string): short label
- `description` (string): how it works
- `pros` (string[]): advantages
- `cons` (string[]): disadvantages
- `recommended` (boolean): true for the recommended approach

Example:
```json
[
  {
    "name": "Event-driven pipeline",
    "description": "Each verification step emits events consumed by the next. Steps run independently and communicate through an event bus.",
    "pros": ["Easy to add new steps", "Steps can run in parallel", "Clear separation of concerns"],
    "cons": ["Harder to debug event flow", "Event ordering complexity", "More infrastructure code"],
    "recommended": true
  },
  {
    "name": "Sequential middleware chain",
    "description": "Steps are chained as middleware functions. Each step receives input, processes it, and passes to the next.",
    "pros": ["Simple mental model", "Easy to debug", "Familiar pattern"],
    "cons": ["Cannot parallelize", "Adding steps requires chain modification", "Tight coupling"],
    "recommended": false
  }
]
```

Output ONLY the JSON array, no surrounding text or markdown fences.

## Design context
{{context}}
