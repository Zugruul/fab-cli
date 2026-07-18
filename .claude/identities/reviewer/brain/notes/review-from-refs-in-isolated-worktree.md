---
tags: [review, git, workflow]
paths: ["**"]
strength: 2
source: "PR#91 (issue #7, FAB-012) — applied successfully"
graduated: false
created: 2026-07-18
---

Reviewer agents must never operate on the shared checkout (another session may own its branch/HEAD): from the FIRST command, review from git refs (`git diff main...origin/<branch>`, `git show <ref>:<path>`, `gh pr diff`) and do any test-running in a private `git worktree` under a job tmp dir, removed afterward. This is a standing property of the multi-agent setup, not a per-task instruction.
