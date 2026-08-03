---
tags: [briefs, delegation, conventions]
paths: ["pipeline/**"]
strength: 1
source: "PR#235 APP-025 retro"
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Briefs should state the repo CONVENTION and let the dev ground on real code, not over-specify exact file targets. APP-025's brief said 'extend pipeline/src/cli.ts' — wrong shape (single-purpose entry point, not a dispatcher); the dev correctly deviated to the per-concern cli.ts convention and documented why. Cost: a redesign pass + a decision the dev had to justify alone.
