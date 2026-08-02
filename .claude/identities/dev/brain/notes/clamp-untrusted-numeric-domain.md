---
tags: [retrieval, input-validation, invariants]
paths: []
strength: 1
source: "PR #206 / BUG-198 round 2"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

One-sided clamps on untrusted numbers re-open the bug class they patch. BUG-198 round 1 clamped link propagation with min(1, hopDecay*weight) — bounding only the upper end. Negative weights leaked amplification via the sign channel (double negation over two hops: (-2)(-2)=+4), and NaN/Infinity weights poisoned or bypassed the bound; a symmetric [-1,1] clamp still re-amplifies via double negation. Fix that survived adversarial review: define the multiplier's valid domain outright — skip links unless Number.isFinite(m) && m > 0, then cap at 1, so the multiplier is unconditionally in (0,1] and the no-amplification invariant holds for any topology and any adversarial weight. When sanitizing untrusted numeric input, enforce the whole valid domain (sign, finiteness, range), not just the direction the observed failure came from.
