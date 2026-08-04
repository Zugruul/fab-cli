---
tags: [review, spec-compliance, commit-message, claims, runtime-timing, untestable-defects]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 257 review round 1, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# Defects that live between what a change DOES and what it CLAIMS

Some defects are invisible to every test because the code is correct in
isolation — it is simply **wired somewhere it cannot act**. The tests pass, the
logic is right, and the change still doesn't do what its commit message says.

Worked example: a change added a hard failure for "build is VALID but hidden
from testers", and wired the check into a release script immediately after
upload. But the checked condition only becomes observable once processing
reaches VALID, which takes minutes to hours — so at the moment the check ran,
the state was always still PROCESSING and the new failure path could
essentially never fire. Correct code, correct tests, wired where it was inert.
The commit message nonetheless claimed the script now "fails loudly" on the
problem.

**How to catch this class — a routine review step, since no suite can:**
1. Read the change's **stated motivation** (commit message, PR body, issue).
2. Find where the new logic is actually **invoked**.
3. Ask whether the condition it checks can be **true at that moment** — check
   runtime timing, lifecycle state, and the project's own docs about it.
4. Treat an overstated commit message or doc as a **finding in its own right**,
   not a cosmetic nit. The claim is what future maintainers will trust.

The fix is often a choice between making the code match the claim and making
the claim match the code. Both are legitimate; silently leaving them divergent
is not.
