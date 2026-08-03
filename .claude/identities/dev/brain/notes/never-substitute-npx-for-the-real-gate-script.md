---
tags: [gate, npx, tooling]
paths: ["**"]
strength: 1
source: ""
learned-from: task 223
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

`npx tsc --noEmit` reported "No errors found" while `npm run typecheck` (nominally the same command) caught 3 real type errors on the same tree — npx resolved a different/cached tsc than the workspace's pinned local binary. Never substitute a bare `npx <tool>` invocation for the project's actual script (`npm run <script>`), even when they "should" be equivalent; ad hoc npx runs are not a gate proxy and can produce false greens.
