---
tags: [process, brains, methodology]
paths: ["**"]
strength: 1
source: "session-end retro, PRICE epic"
graduated: false
created: 2026-07-12
---

Minting a brain note after every PR close and re-injecting the relevant subset into the NEXT task's dev/reviewer briefs measurably compounded quality across this 21-PR epic — later reviews caught subtler issues than earlier ones (e.g. the type-collision catch on PR#50 vs the empirical-threshold-verification catch on PR#63), and devs stopped repeating earlier mistakes (cache contract, provider-prefixed types, per-condition guards). The value scales with epic length — worth the minting overhead especially on long multi-task builds, not just short ones.

Related: [[epic-scoped-merge-authorization]]
