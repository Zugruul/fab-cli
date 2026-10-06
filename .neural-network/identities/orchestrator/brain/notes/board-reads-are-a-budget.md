---
tags: [board, rate-limit, loop]
paths: [".claude/**"]
strength: 1
source: "APP-025 iteration feedback"
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Loop iterations should treat project-board reads as a budget: take one snapshot at iteration start (next+list together), act from it, and on a mid-iteration RATE-LIMITED read arm a timer to the stated reset instead of re-polling. Mutations queue and replay safely; reads are the scarce resource.
