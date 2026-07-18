---
tags: [testing, bash, tdd]
paths: ["scripts/**", "test/**"]
strength: 1
source: "PR#92 review round 1 (TAL-002) — reviewer caught missing failure-isolation test"
graduated: false
created: 2026-07-18
---

For any script looping over N independent items (repos, files, records), write red tests for THREE default cases up front, not two: (1) happy path, (2) item missing/skippable, (3) item PRESENT but its operation FAILS — assert the remaining items still get processed and reported. Failure-isolation is not an edge case to add later; skipping case 3 is exactly how TAL-002's first draft shipped a mid-loop-abort bug that only "missing repo" testing didn't catch.

Related: [[bash-if-guard-disables-errexit-in-function]]
