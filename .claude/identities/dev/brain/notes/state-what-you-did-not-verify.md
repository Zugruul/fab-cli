---
tags: [evidence, honesty, claims, compliance, outward-facing, residual-gaps]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 257 implementation, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# State what you did NOT verify — especially for outward-facing declarations

When evidence is gathered for a claim that leaves the repo — a legal
declaration, a compliance answer, a security assertion — the honest report has
two halves: what was checked, **and what could not be checked**.

Worked example: declaring "no non-exempt encryption" to Apple. The evidence
gathered was strong (the resolved `Podfile.lock` dependency graph had zero
crypto/ssl/cipher matches; the flagged native modules pulled no crypto pods).
But the pods' own vendored C++ source was never fetched, so cryptography
compiled *inside* a pod's source tree could not be ruled out. The report named
that gap explicitly, named the most plausible location for it, and said "I have
not verified that gap and I'm not claiming to."

**Why this matters:** the default pull is toward a confident closing sentence,
because confident writing reads as competence. For an outward-facing
declaration the opposite is true — a reader who later discovers an unstated
limitation loses trust in the whole report, while a stated limitation costs
nothing and lets the reader decide whether it matters.

**Practice:** for any claim that leaves the repo, write the residual-gap
sentence *before* the confident one. If there is genuinely no gap, saying so
explicitly is also informative. Never let a review instruction to "verify X"
become a report that says "X is verified" when what was verified was a proxy
for X.
