---
tags: [gate, verification, worktree, gitignore]
paths: ["**"]
strength: 1
source: "PR#113 (TAL-024) code-quality review"
graduated: false
created: 2026-07-19
---

When a task's test depends on files the dev agent generated during its own session (even legitimately, as working output), re-verifying gate green in that SAME worktree only proves the test passes when those session-local artifacts happen to be present -- it does not prove the gate is reproducibly green on a fresh checkout. This is especially dangerous when those artifacts are gitignored (so they will never exist for a reviewer, CI, or the next contributor). Before trusting a gate-green claim for any task whose test could plausibly read gitignored/session-local state, check out a genuinely FRESH worktree from the pushed remote branch (not the dev agent's own working directory) and run the gate there with zero prior session history. Caught only by a reviewer explicitly doing this on TAL-024 -- the orchestrator's own pre-review gate check missed it by re-running in the dev agent's already-populated worktree.
