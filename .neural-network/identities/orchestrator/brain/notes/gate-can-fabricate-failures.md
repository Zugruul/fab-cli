---
tags: [gate, caching, flake, false-positive, tooling, triage]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 258, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# A gate that FABRICATES failures is worse than one that hides them

Known and already tracked: a filtering wrapper can **hide** real failures
(reporting "no errors" on a tree with genuine errors). The inverse also
happens and is more dangerous.

Observed: after local experimental edits were reverted and verified
byte-identical to the committed state, the full gate reported failures
**matching the reverted edits** — while running the same tests through a
different entry path was consistently green. Root cause: stale build/dependency
caches (`node_modules/.vite`, `.vite-temp`) served by the gate's entry path
instead of re-transforming current source. Clearing them produced four
consecutive green runs.

**Why worse than hiding:** a hidden failure eventually resurfaces somewhere.
A *fabricated* failure can make correct code look broken — pressuring an
author into "fixing" working code, or into believing a critical invariant has
regressed. In the observed case the phantom failure precisely mimicked the
security bug the whole task existed to prevent, so it read as "the merge
blocker just regressed."

**Two cheap, decisive discriminators:**
1. A failure **count that varies across identical-tree runs** is
   nondeterminism, not a regression.
2. **Disagreement between two entry paths on the same tree** (direct test
   runner vs the gate wrapper) points at caching, not code.

**Standing practice:** clear build caches before believing a red gate that
doesn't reproduce directly; gate tooling should clear its own caches so its
verdict never depends on the runner remembering a manual precondition.

Related: [[never-pipe-a-gate-exit-code]] — both are cases of the gate's
verdict not meaning what it appears to mean.
