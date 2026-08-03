---
tags: [tooling, typecheck, rtk]
paths: ["pipeline/**", "fab-cli/**", "fab-app/**"]
strength: 1
source: "PR#241 APP-085 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

rtk's filtered tsc summary reported 'TypeScript: No errors found' on a build with a real TS2339 error (PR#241). Never treat a single-package rtk-wrapped tsc as the last correctness check before push: verify via rtk proxy npx tsc --noEmit (unfiltered), the raw tee log, or the root npm run gate (pnpm -r), which is what actually surfaced the error. Flagged upstream to the human (rtk owner).
