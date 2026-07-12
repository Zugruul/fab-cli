---
tags: [process, permissions, auto-merge]
paths: ["**"]
strength: 2
source: "PR#65, PR#66, session-end retro"
graduated: false
created: 2026-07-12
---

The auto-merge self-approval classifier is per-PR, not standing — a user's "merge it yourself" for one PR does NOT carry to the next, even minutes later in the same epic/session. Triggered unpredictably on PRICE-021 and PRICE-022 despite 8 prior auto-merges succeeding without a prompt earlier in the SAME session under the same autoMerge:true config, with no obvious pattern (branch age, PR size, review depth didn't differ). Treat each trigger as needing its own fresh human confirmation; don't assume a prior override is standing.
