---
tags: [testing, distribution, synthetic-data, coverage, fixtures, real-scale]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 256, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# A mechanism can be correct, tested, and never actually triggered

Unit tests verify that a mechanism **works when triggered**. They say nothing
about whether it is **ever triggered** at real scale. A feature can be
correct, mutation-proven, visibly rendering, and still contribute nothing.

Worked example: occlusion modelling for synthetic training data — dice, hands
and card stacks. The `visibleFraction` computation and the exclusion threshold
were both kill-first proven (mutating the occluder-skip killed 2/6 tests), and
a die was plainly visible in the output. But across a full real run of 130
labeled cards: `excludedCards: 0`, and **minimum `visibleFraction` = 0.965**.
Nothing ever covered more than 3.5% of a card. Real reference footage is full
of hands sweeping across cards.

A fixture that places one occluder over one object tests the *mechanism*. It
cannot detect that the generator's actual *distribution* never puts an
occluder anywhere meaningful.

**Rule: for any feature whose purpose is to inject variation, assert on the
distribution of variation actually produced over real-scale output** — e.g.
"across N outputs, at least X% of items fall below threshold T, and at least
one is excluded outright" — not merely that the code path exists and functions.

This generalizes past occlusion to anything sampled: jitter that never
jitters, error injection that never errors, retry logic that never retries,
a fallback tier never reached.

Related: [[looks-right-is-a-prompt-to-measure]], [[verification-has-an-axis]].
