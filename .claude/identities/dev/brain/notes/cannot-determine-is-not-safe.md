---
tags: [security, guards, fail-closed, symlinks, path-containment, error-handling]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 258 review rounds 1-4, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# "Cannot determine" must never be encoded as "safe"

A whole family of security and correctness defects share one shape: **a check
that cannot observe a condition, whose silence is read as the condition being
absent.** Three instances in one task, each a separate review round:

1. `path.resolve` is purely lexical — it cannot consult the filesystem. Its
   silence about symlinks was read as "this path is contained."
2. `fs.realpathSync` throws ENOENT on a **dangling** symlink — i.e. on
   "something is here and it points elsewhere." That throw was read as
   "nothing is here," so the walk fell back to the safe parent and passed.
3. "No outbound network calls exist" was read as "this component is not
   reachable." It says nothing about inbound.

Each check was correct about what it could see. The defect was in what it
could not see being treated as benign.

**Rules:**
- When writing a guard, state explicitly **what it cannot observe**.
- Make unresolvable / unknown / error states **fail closed**. If a resolution
  step throws, the safe reading is "something is wrong here," never "nothing
  is here."
- When reviewing a guard, ask: *what does this NOT look at, and what would an
  attacker (or an unlucky config) put there?*

Applied correctly afterwards in the same task: a symlink-chain walk added a
hop cap that treats "cannot resolve within N hops" as an **escape**, not a
pass — the inversion of the bug, deliberately.

Related: [[verification-has-an-axis]].
