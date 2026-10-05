---
tags: [tooling, typecheck, rtk]
paths: ["pipeline/**", "fab-cli/**", "fab-app/**"]
strength: 2
source: "PR#246 #244 retro (3rd strike, severity upgraded)"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-04
---

rtk's filtered tsc/vitest summaries can report false-green — THIRD live hit 2026-08-04: 'No errors found' on brand-new red test files importing nonexistent modules (~35 real compile errors), which would have silently invalidated the TDD red step itself, not just missed a bug. Route every correctness-gating check through rtk proxy (unfiltered) or the root gate; treat any filtered summary as advisory only. Escalated upstream to the rtk owner.
