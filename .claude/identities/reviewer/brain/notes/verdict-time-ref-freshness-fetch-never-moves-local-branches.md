---
tags: [review, git, staleness, concurrency]
paths: ["**"]
strength: 1
source: ""
learned-from: task 217 round-1 stale review
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

`git fetch` never moves local branches — a local branch can lag origin/<branch> right after a fetch. Round 1 of PR #224's review was produced from the local `fab/217-i18n` pointer while the dev's fixes sat 3 commits ahead on origin: every blocking finding was already fixed, the round was wasted, and the "root cause" narrative was confidently wrong. Standard practice now: (a) immediately before the run that produces the verdict — and again after any conversational delay — run `git log <branch>..origin/<branch> --oneline` (or rev-parse both) and treat ANY delta as "re-review from the new tip"; (b) build the gate reproduction from `origin/<branch>` in a disposable worktree, never from the shared checkout's local pointer, which a concurrent agent can mutate mid-review (cuts both ways: false-stale = missed fixes, false-contaminated = uncommitted WIP masquerading as the PR); (c) verify checker-tests aren't vacuous by reintroducing the bug class on a scratch copy inside that disposable worktree and watching the check fail, then restore and remove.
