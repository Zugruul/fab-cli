---
tags: [permissions, consent, orchestration]
paths: ["**"]
strength: 1
source: "PR#111 (TAL-023) loop-feedback"
graduated: false
created: 2026-07-18
---

A standing consent for one class of action (e.g. auto-merge PRs on this project) does not automatically cover a structurally different class of externally-visible action that arises later (e.g. push to a different, third-party repository the user owns). When a task would be the first to exercise a materially different kind of GitHub/external-system-visible action, ask once, scoped to that specific action, before proceeding -- even in an otherwise fully autonomous session. Offer a middle-ground option (do everything except the risky/visible step) alongside yes/no so the human has a real choice, not a binary gate.
