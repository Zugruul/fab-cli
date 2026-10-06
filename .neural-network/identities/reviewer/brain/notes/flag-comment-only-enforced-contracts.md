---
tags: [review, types, contracts]
paths: ["src/**"]
strength: 1
source: "PR#107 (TAL-020) code-quality review"
graduated: false
created: 2026-07-18
---

Watch for contracts enforced only by a comment, not by the type system (e.g. a field documented 'required when X is true' but TypeScript doesn't enforce it). These are legitimate non-blocking findings worth flagging explicitly -- they degrade silently (empty output, no crash) rather than fail loudly when a future caller violates the contract, which makes them easy to miss and costly to leave unflagged.
