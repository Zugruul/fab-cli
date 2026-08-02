---
tags: [process, delegation, communication]
paths: []
strength: 1
source: "PR #211 / BUG-199 (dev idled mid-red-phase)"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

A dev agent that arms a background wait (Monitor on a pnpm install, a long test run) and then goes idle 'until notified' has silently stopped delivering — from the outside it is indistinguishable from a hang, and the orchestrator has to burn a round inspecting the lane (uncommitted files, zero commits, no PR) and re-briefing. Background waits are for the process that owns the loop, not the agent doing the task: while a long command runs, keep driving (write the next test, draft the commit message, prepare the PR body), and when there is genuinely nothing to do but wait, wait in the foreground of the task — never end the turn with work uncommitted and unreported. If blocked, say exactly what on, immediately; silence is the one unacceptable state.
