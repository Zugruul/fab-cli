---
tags: [concurrency, gate, bookkeeping, shared-tree, derived-artifacts, triage]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 257 iteration, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# Orchestrator bookkeeping can turn every concurrent lane red

Bookkeeping actions that write **generated/derived artifacts** into the shared,
gated tree (regenerated indexes, manifests, caches) break the gate for every
in-flight lane simultaneously — on a failure none of their diffs contain.

Observed: minting a brain note that declared entity keys left the generated
entity index stale, failing a test in the monorepo-wide gate. Two lanes went
red. The dev correctly diagnosed it as unrelated to its branch and correctly
refused to run the heavyweight editorially-gated sync — but lost a cycle, and
the orchestrator initially treated it as the lane's problem.

**Rules:**
1. After any bookkeeping action that could stale a derived artifact, run the
   **narrow** regeneration command and re-check the gate BEFORE telling any
   lane to gate.
2. When a gate goes red on something outside every lane's diff, triage it as
   **shared-tree breakage first**, not as the lane's problem. "The failure is
   not in my diff" from a dev is a strong signal, not an excuse.
3. Prefer the narrowest regeneration command available. A broad sync may be
   gated on review/editorial that the situation doesn't actually require.
