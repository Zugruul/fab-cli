---
tags: [tdd, commits, discipline]
paths: ["**"]
strength: 1
source: "PR#114 (TAL-030) loop-feedback"
graduated: false
created: 2026-07-19
---

Even when a brief explicitly specifies a red-then-green commit pattern with worked examples from prior similar tasks, it's easy to collapse the test-and-implementation commits into one. This forces every downstream reviewer to redo verification work (reproduce red-without-the-artifact by temporarily removing it and re-running the test) that a compliant commit history would have made self-evident. When doing doc-task-adapted TDD, after the first commit, explicitly check git log/git show shows ONLY the test file changed before writing any implementation content -- a mechanical self-check, not just intent to follow the pattern.
