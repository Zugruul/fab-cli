---
tags: [review, tdd, process]
paths: ["**"]
strength: 1
source: "PR#114 (TAL-030) spec-compliance review"
graduated: false
created: 2026-07-19
---

Treat 'was the process followed' (e.g. red-then-green commit split) and 'is the delivered artifact real' as SEPARABLE questions when judging a process deviation. Process deviations are always worth flagging, but only block the PR when nobody has independently verified the output the process was supposed to guarantee. If an outside party (a fellow reviewer, the orchestrator) already reproduced the red state directly, the process gap is a retro note, not a merge blocker -- the guarantee the process exists to provide has been obtained a different way.
