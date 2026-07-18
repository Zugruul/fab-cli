---
tags: [review, testing, rigor]
paths: ["test/**"]
strength: 1
source: "PR#98 (TAL-011) code-quality review"
graduated: false
created: 2026-07-18
---

When a PR adds a new structural/citation test that's a sibling of an earlier similar test in the same repo (same genre of doc-verification test), diff the two tests' rigor directly -- thresholds, density checks, ordering checks -- rather than judging the new one in isolation. A quietly-lowered bar can pass gate and look individually reasonable while being measurably weaker than its predecessor; side-by-side comparison is what surfaces it.
