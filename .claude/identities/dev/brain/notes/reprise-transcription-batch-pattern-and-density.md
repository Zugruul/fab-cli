---
tags: [content, transcription, eval-suites]
paths: ["pipeline/**"]
strength: 1
source: ""
learned-from: task 134
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Expanding the human-authored adjudication suite (pipeline/eval-suites/human-adjudication/): kb/rules/reprise/*.md chunks have clean frontmatter with per-article source_url — extraction from "Quick Questions"-style worked examples (named scenarios) is mechanical, not interpretive. Pattern that worked for 141 items: 4 parallel subagents, each owning 2-4 articles and an independent output file, ZERO coordination — then central validation afterward (schema, unique ids, sourceUrl-vs-frontmatter cross-check, token-Jaccard dup check at 0.6 and 0.9). Article density varies (6-13 genuine items each) — never force a per-file quota, let density decide and report real counts. Only 13 of ~45 available reprise articles are used so far — big headroom for suite growth with the same pattern.
