---
tags: [review, citations, verification]
paths: ["**"]
strength: 1
source: "PR#114 (TAL-030) spec-compliance review"
graduated: false
created: 2026-07-19
---

Separate 'is the claim falsifiable and checked' from 'does the claim carry the finding' when weighing a citation error. Aggregate counts (grep totals, tallies) are exactly the kind of number an author eyeballs or miscounts, while pinned citations (file:line, function names, config values) are copy-pasted from real tool output -- they fail independently and should be weighted differently, not averaged into one accuracy score. A wrong aggregate count next to many exact pinned citations is a correction, not a credibility collapse -- but only call it non-blocking after confirming the qualitative claim it supports is independently evidenced by OTHER correct citations in the same finding. If a wrong number were the ONLY support for a finding, it would block.
