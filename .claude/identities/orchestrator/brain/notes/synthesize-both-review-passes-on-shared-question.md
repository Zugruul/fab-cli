---
tags: [review, synthesis, orchestration]
paths: ["**"]
strength: 1
source: "PR#106 (FAB-040) — two passes independently investigating the same flagged design question"
graduated: false
created: 2026-07-18
---

When two independent review passes (spec-compliance and code-quality) investigate the SAME open design question from a PR description, their conclusions are often complementary rather than redundant — one may prove WHY a mechanism doesn't work (spec-compliance traced the real 'no re-parse' guarantee to round-diffing, not the cache), the other may prescribe WHAT to do about it (code-quality recommended removing the dead cache wrapper). Synthesizing both into a single fix (rather than picking one review's recommendation and ignoring the other) produced a more complete, better-reasoned outcome than either alone — spec-compliance's explicit warning against a naive 'bump the TTL' fix prevented introducing a staleness regression that code-quality's review alone hadn't explicitly ruled out.

Related: []
