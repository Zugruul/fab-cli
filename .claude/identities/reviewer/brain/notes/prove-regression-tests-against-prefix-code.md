---
tags: [review, test-rigor, verification]
paths: []
strength: 1
source: "PR #206 round 2 / PR #207 review"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

A regression test only counts as evidence once it has failed against the buggy code. In PR #206 round 2, the reviewer checked out the round-1 (pre-fix) version of linkExpansion.ts underneath the new test file, ran the suite, and confirmed the negative-weight/NaN/Infinity tests fail there (then restored the file, clean tree). That converts 'the dev says these are regression tests' into proof — and it caught nothing this time, but the same probe in PR #207 style reviews (reproducing an issue's cited real-world hash values with a live exporter run) is what separates fixture-passing theater from verified behavior. When reviewing a fix round: run the new tests against the pre-fix code and require the load-bearing ones to fail.
