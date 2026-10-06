---
tags: [testing, ui, end-to-end, interaction-layer, coverage-gaps]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 258, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# A deliverable's human-facing surface needs verification THROUGH that surface

An interactive tool's primary interaction can be **completely dead** while
every automated check passes, if all checks reach the system through a
different interface than the human does.

Worked example: a labeling tool's core action — click to place a card's four
corners — was gated on a counter being `> 0`, which is false on the first
click. Clicking did nothing, ever. It survived:
- the full unit suite,
- an end-to-end "real-data run" over 15 real user photos,
- a full adversarial review round.

All three drove the tool over its **HTTP API**. The one interface a human
would actually use was the only one never exercised. It was found by
dispatching real `MouseEvent`s.

**Rules:**
1. An end-to-end run that bypasses the real entry point **is not
   end-to-end** — name the interface it actually used when reporting it.
2. Any deliverable with a human-facing interaction surface needs at least one
   verification **through that exact surface** before it is called done.
3. When a task's disclosed gaps include "X was never exercised by a real
   Y" — treat that as a likely-defect signal, not a documentation nicety.
   Here the disclosed gap ("corner dragging never exercised by a real
   pointer") turned out to understate it: the more fundamental *placement*
   step was also unexercised, and was broken.

Cheap coverage that would have caught it: a jsdom/happy-dom harness around
the client's state-machine functions, or one driven smoke test performing the
literal human sequence.

Related: [[verification-has-an-axis]].
