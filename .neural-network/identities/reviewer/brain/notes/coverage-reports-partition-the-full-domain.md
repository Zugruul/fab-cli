---
tags: [review, coverage, invariants, reporting, completeness, arithmetic]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 268, 2026-08-05
graduated: false
created: 2026-08-05
last-touched: 2026-08-05
---

# A coverage report must partition the FULL domain, not what happens to be at hand

A completeness report built from *incidental* sources can assert 100% while
silently omitting members of the domain it claims to cover.

Worked example: a coverage report partitioned into three states — covered /
eligible-but-not-placed / unavailable-upstream — but built that partition from
(a) what happened to be cached on disk, and (b) a failures manifest that a
later partial run had **overwritten**. An item in neither source fell into **no
state at all** and vanished, while the report declared full coverage.
Reproduced live: `report accounts for 2 / 3 catalog printings; printing-c
mentioned anywhere? false`.

**Rules:**
1. Partition the **full known domain**, enumerated from its authoritative
   source — never `sourceA ∪ sourceB` of whatever is available at report time.
2. Publish the domain total in the artifact (`totalCatalogSize`) and assert
   **states sum to it**. The invariant then becomes checkable from the output
   alone, by anyone, later — not trusted.
3. Test the invariant, and kill-first it: make one member vanish, watch it fail.

**Why the invariant and not another guard:** the author had *already* guarded
the omission path they imagined (stale entries). The bug arrived through the
adjacent one (a never-attempted item). Special cases close instances;
arithmetic over the full domain closes the class.

Stakes are asymmetric wherever the report gates a downstream guarantee — here,
a missing item meant a card the app could **never** identify, with no graceful
degradation and no signal until a user hit it.

Related: [[verification-has-an-axis]].
