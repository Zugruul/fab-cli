---
tags: [review, evidence, measurement, independence, epistemics, regression-locks]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 256, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# Agreement between measurements that SHARE an input is a tautology

Before citing agreement between two measurements as corroboration, verify
their inputs are **disjoint**. A shared sample makes agreement guaranteed by
construction and evidences nothing.

Worked example: two rig configs were each measured against 3 captures, and
their close agreement (~1%) was cited — in unusually confident language ("not
a coincidence... not assumed") — as proof they share a production template.
One capture appeared in **both** sets, and was mislabelled in one as belonging
to the other rig. The confidence was highest exactly where the reasoning was
weakest.

**This class of defect is EPISTEMIC, not numeric.** The measured values were
entirely correct — re-measuring with a disjoint set reproduced them, proven by
an identical config hash and identical output metrics. What was wrong was the
*evidence* and the *conclusion drawn from it*.

So the fix is: correct the evidence, re-derive the conclusion, and **do not
churn values that were never wrong** to appear responsive. If the conclusion
survives on the corrected evidence, KEEP it — deleting a claim you can now
actually support is its own dishonesty.

**Mechanically checkable.** Evidence-citation defects feel like review-only
concerns, but disjointness is a test: extract sample identifiers structurally
from raw data (not by matching prose, which phrasing can evade) and assert no
identifier is cited twice; require a minimum population so the check cannot
pass vacuously with one config.

Related: [[verification-has-an-axis]], [[state-what-you-did-not-verify]].
