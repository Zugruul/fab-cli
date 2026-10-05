---
tags: [review, parsers, gates]
paths: ["**"]
strength: 1
source: ""
learned-from: task 135 review
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

For any regex/parser/extractor that feeds a pass/fail gate decision: explicitly test the multi-match/CONFLICTING-match case, not just present/absent/malformed. First-match-wins parsing has asymmetric failure — the dangerous direction is silent (a stale APPROVE shadowing a corrected BLOCK approved a major release in #135's original code). It's a 2-minute probe ("what happens with two conflicting valid inputs"), works as a standing checklist bullet on originally-authored code and reviews alike. Corollary for round-2 passes: mutation-revert the author's fix (~2 min) and demand a clean failure signature from the new tests — proves they pin the fix, not just the new type shape.
