---
tags: [review, git, workflow]
paths: ["**"]
strength: 1
source: "PR#89 (TAL-001) reviewer retro — shared-checkout near-miss"
graduated: false
created: 2026-07-18
---

Reviewer agents must never operate on the shared checkout (another session may own its branch/HEAD): from the FIRST command, review from git refs (`git diff main...origin/<branch>`, `git show <ref>:<path>`, `gh pr diff`) and do any test-running in a private `git worktree` under the job tmp dir, removed afterward. This is a standing property of the multi-agent setup, not a per-task instruction.
