---
tags: [tdd, commits, hooks]
paths: ["**"]
strength: 1
source: ""
learned-from: task 217 red-first hook block
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

The red-first board-move hook treats package.json/lockfile deps chores as "implementation files": a `chore: add dependencies` commit BEFORE the test-only red commit blocks the move to In review ("no earlier test-only commit on this branch"), even when tests genuinely came first — #217's branch needed a full history reorder + force-push to fix. Standard order on a fresh branch: (docs-only commits are exempt) → red test-only commit FIRST → then the deps chore → then implementation. If the tests can't even run without the deps, that's fine — the red commit's message should say the suites fail to import, which is still red.
