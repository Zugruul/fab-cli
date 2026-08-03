---
tags: [review, verification, gates]
paths: ["pipeline/**", "fab-cli/**", "fab-app/**"]
strength: 1
source: "PR#239 APP-027 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Mechanism claims ('X is wired into the gate', 'this check blocks Y') are a categorically higher-risk claim class than fact claims — text can look correct while the wiring silently no-ops. Validate by EXECUTION: deliberately break the implementation, watch the mechanism fail for real, restore. Reading confirms a claim is stated; executing confirms it works and the tests have teeth. PR#239: broke rotated_iou -> proved pytest actually gates.

Related: [[prefix-swapback-verification]]
