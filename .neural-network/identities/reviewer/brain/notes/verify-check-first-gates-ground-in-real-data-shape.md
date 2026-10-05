---
tags: [review, verification, data-shape]
paths: ["**"]
strength: 1
source: "PR#112 (TAL-022) code-quality review"
graduated: false
created: 2026-07-18
---

When reviewing a 'check first, skip if present' gate in any pipeline, don't accept it just because it names the right file/step -- verify it grounds the check in the target's ACTUAL data shape/field format, not a plausible-looking guess. A check that only gestures at 'grep for X in file Y' without stating the exact key format the file actually uses will silently reintroduce the same false-negative bug under a different input next time. The durable fix states the concrete data shape explicitly and calls out that a differently-shaped guess is a false negative, not proof of absence.
