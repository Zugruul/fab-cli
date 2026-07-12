---
tags: [process, permissions, auto-merge]
paths: ["**"]
strength: 1
source: "PR#65, PR#66"
graduated: false
created: 2026-07-12
---

The auto-merge self-approval classifier is per-PR, not standing — user authorization to merge one PR ("merge it yourself") does NOT extend to the next PR even in the same epic/session. Ask again each time it triggers; never assume a prior "yes" covers a new PR. Observed on PRICE-021 (#65) and PRICE-022 (#66) despite 8 prior auto-merges succeeding without a prompt in the same session — the classifier's threshold/trigger conditions aren't fully predictable, so don't rely on autoMerge:true alone for late-epic PRs.
