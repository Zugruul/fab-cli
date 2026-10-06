---
tags: [review, verification, blind-spots, test-shape, threat-model, evidence-independence]
paths: []
strength: 1
source: ""
learned-from: tasks 256/257/258, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# Every verification has an AXIS — a defect on another axis is invisible to it

Rigour does not help if the check is aimed at the wrong dimension. Four
independent instances in a single session, each a real, correct, careful
verification that could not see the defect:

| verification performed | axis it covered | axis the bug lived on |
|---|---|---|
| "no outbound network code" | outbound calls | **inbound** exposure (unauthenticated read/write) |
| traversal tests with `../`, `%2e%2e`, absolute paths | string payloads | **real filesystem state** (symlinks) |
| unit suite + real-data run + review | the HTTP API | **real pointer events** (primary interaction was dead) |
| pixel-sampled geometry measurement of two configs | the numbers | **the evidence set** (both shared an input, making agreement circular) |

Each check was correct at what it measured. Each was aimed at the wrong axis.

**Before accepting a verification, ask what dimension it operates in versus
what dimensions the failure could occupy.** Common axes to enumerate:
- *interface* — API vs the surface a human actually uses
- *data form* — a payload shaped like the input vs the real substrate
- *direction* — outbound vs inbound, read vs write
- *evidence independence* — do two "agreeing" measurements share an input?

Corollary: **driving the artifact the way its real user will is a distinct
verification mode, not a redundant one.** In this session it found two live
defects in one afternoon that the full suite, a real-data run, and an
adversarial review round had all missed.

Related: [[state-what-you-did-not-verify]], [[claim-versus-wiring-defects]].
