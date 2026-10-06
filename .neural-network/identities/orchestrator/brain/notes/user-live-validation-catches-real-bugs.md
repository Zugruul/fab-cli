---
tags: [process, validation]
paths: ["**"]
strength: 1
source: "issue #61"
graduated: false
created: 2026-07-12
---

The user manually opened the real TCGplayer/Cardmarket listing pages and screenshotted the discrepancy — this caught two real defects (fabricated fills, cross-finish contamination) that gate-green code review missed because fixtures encoded the SAME wrong assumptions as the implementation. Lesson: for any command whose output claims to mirror an external live source, periodically live-smoke against the actual source (not just fixtures) before considering a feature done — fixtures can't catch "the implementation and the fixture share the same wrong mental model."

Related: [[real-data-only-doctrine]]
