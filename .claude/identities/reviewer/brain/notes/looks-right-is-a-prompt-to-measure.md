---
tags: [review, geometry, measurement, visual-inspection, invariants, regression]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 256, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# "Looks right" is a prompt to measure, not a substitute for measuring

For geometric or numeric output, visual inspection can confirm that a
transform RAN while being completely blind to whether it ran CORRECTLY.
Plausible-looking output is the *expected* result of a wrong-magnitude
transform, not evidence against one.

Worked example: generated training images were inspected and passed, with the
inspector specifically noting "non-rectangular quads confirm the homography
applies." True — and it measured nothing. Every card was compressed to
**0.259** of its correct **0.716** aspect, a 2.8x squash. It was found only by
computing a numeric property of the labels and comparing it against a known
true value (a real card is 63x88mm).

**Practice:**
1. Identify a measurable invariant with a **known true value** — a physical
   ratio, a conservation law, a count that must balance.
2. Compute it over **real-scale output**, not a fixture.
3. Report the number, not the impression.

The tell that an inspection is measuring nothing: it confirms a mechanism is
*present* ("the perspective is applied", "the labels exist") rather than
*correct within a tolerance*.

Corollary — **a measurement that finds a defect should become a standing
check.** In this same task, a later fix for an unrelated visual artifact
shrank a canvas dimension, broke the calibrated relationship the geometry fix
depended on, and silently reintroduced the squish (0.672 -> 0.577). The author
caught it by re-running this very measurement. Fixes for B routinely violate
the invariant established by the fix for A.

Related: [[verification-has-an-axis]].
