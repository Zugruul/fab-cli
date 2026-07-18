---
tags: [review, api-design, correctness]
paths: ["src/**"]
strength: 1
source: "PR#103 (FAB-023) code-quality review round 2"
graduated: false
created: 2026-07-18
---

When a helper function resolves an entity (e.g. a search->id lookup) internally as a means to an end, and the caller separately needs that same identifier for its own purposes (e.g. a citation URL), the caller re-deriving it via an independent second call is a real correctness risk, not just an efficiency nit — two independent calls to the same non-deterministic-ish endpoint (search relevance ranking, no documented secondary sort key) aren't guaranteed to agree. The fix is always to widen the helper's return type to expose the already-resolved identifier, never to accept 'it'll almost certainly match' as good enough. Caught on PR#103 (FAB-023): fetchCardRulings() resolved a card_id internally but returned only the rulings; the caller's own independent second search call for the citation URL could in principle diverge from the first.

Related: []
