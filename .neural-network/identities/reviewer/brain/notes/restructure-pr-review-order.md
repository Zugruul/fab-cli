---
tags: [review, monorepo, renames]
paths: []
strength: 1
source: "APP-001 PR#166 review"
confidence: direct
graduated: false
created: 2026-08-01
last-touched: 2026-08-01
---

Move-heavy/restructure PRs: review the NON-rename diff first (git diff --stat --find-renames, isolate <100% similarity files), then hunt generated artifacts that entered history (log --stat by extension), then verify ignore-file splits against each output path's real resolution anchor. Pure-rename verification alone misses all three real defect classes.
