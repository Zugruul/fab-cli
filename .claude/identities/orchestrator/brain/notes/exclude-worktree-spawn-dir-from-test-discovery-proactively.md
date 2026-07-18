---
tags: [testing, worktree, concurrency, config]
paths: ["vitest.config.ts", "**"]
strength: 1
source: "PR#98 (TAL-011) loop-feedback, bug #99"
graduated: false
created: 2026-07-18
---

In a workflow where concurrent sessions each spawn dev/reviewer subagents into git worktrees under a shared directory (e.g. .claude/worktrees/), a test runner's default discovery glob can pick up ANOTHER session's in-progress worktree test files and produce false-red failures unrelated to the diff actually being verified -- this bit twice in back-to-back tasks (TAL-010 found it for third_party/**, TAL-011 found the same class of gap for .claude/worktrees/** itself). Proactively exclude the worktree-spawn directory from test discovery as part of initial repo/workflow setup, not reactively per-task.

Treat `third_party/**` and `.claude/worktrees/**` as a MATCHED PAIR whenever a test-discovery exclude list is reviewed or extended: vendored clones and concurrent-session worktrees are the two recurring sources of stray test files in this workflow, and fixing one without the other just reintroduces the same class of cross-session collision from the other direction.
