---
task: wiki-query
tier: mechanical
version: 1
---

# Wiki Query Synthesis

You are answering a question about a codebase using wiki documentation.

Question: {question}

Here are relevant wiki articles:

{articles}

## Instructions

1. Provide a clear, concise answer that directly addresses the question
2. Cite relevant articles using [[article_path]] notation (e.g., [[modules/core.md]])
3. If the articles don't contain enough information, say so explicitly
4. Do NOT guess or hallucinate information not present in the articles
5. If anything is ambiguous, use [NEEDS CLARIFICATION: specific question]
6. Prioritize accuracy over completeness
7. Keep the answer focused — avoid restating the entire article content
