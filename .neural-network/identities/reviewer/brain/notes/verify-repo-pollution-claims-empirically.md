---
tags: [review, testing, verification]
paths: ["test/**"]
strength: 1
source: "PR#73 (issue #72)"
graduated: false
created: 2026-07-17
---

When reviewing a test-only fix that claims to stop a real-repo-file-pollution bug, don't trust the diff claim alone — check out the branch, run the suite, and diff the allegedly-protected file's checksum/git-status before and after. Also grep the WHOLE test file for every call site of the function in question (not just the two the PR description names) to confirm no third instance of the same bug class was missed.
Related: [[stale-mock-arity-and-global-leak]]
