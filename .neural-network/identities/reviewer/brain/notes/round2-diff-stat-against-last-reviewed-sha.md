---
tags: [review, freshness, scoping]
paths: ["**"]
strength: 1
source: ""
learned-from: task 218 round 2
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

On re-review rounds, the high-value freshness check is `git fetch` followed by `git diff --stat <last-reviewed-sha>..origin/<branch>` — not just a commit-list log. One command proves freshness AND scopes exactly what changed, which drives the reproduction decision: a diff that is provably docs-only with zero executable surface (nothing any test/script reads) justifies approving without re-provisioning a worktree or re-running the full gate; any executable surface in the diff means full re-reproduction. State the reviewed SHA in every verdict either way.
