---
tags: [git, resume, ops]
paths: [".claude/**"]
strength: 1
source: "APP-036 iteration feedback"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

Resuming a parked branch after main has moved: FIRST refresh dependencies (pnpm install) and rebase onto main, THEN run the first expensive operation. PR#245 burned two cycles the other way (missing bins on attempt 1, stale install after rebase). Staleness failures on ops tasks cost full build cycles.
