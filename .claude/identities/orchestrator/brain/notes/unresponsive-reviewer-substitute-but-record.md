---
tags: [review, independence, agents, process, honesty, provenance]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 256, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# An unresponsive reviewer: substitute, but record the loss of independence

When an assigned reviewer produces no output and doesn't answer a status ping,
the choice is between an **indefinitely blocked task** and a **review by
someone already involved in the work**. Both are defensible. What is not
defensible is letting the second one look like the first.

Observed: a reviewer went silent mid-review (no worktree activity for 15+
minutes, no reply to a ping). The orchestrator completed the review itself —
but it had relayed findings to the author across three correction rounds, so
it was not independent in the sense the process intends.

**What to do:**
1. **Ping first**, with a deadline implied and with whatever you've already
   verified attached, so a live-but-slow reviewer doesn't redo your work.
2. If still silent, **substitute rather than block** — a stalled lane helps
   nobody.
3. **Record the substitution and the independence caveat where the approval
   lives** (the PR comment, not just a chat message). A later reader will
   otherwise weight it as an independent sign-off, which is the actual harm.
4. Prefer verifying **properties you did NOT previously discuss with the
   author** — those are where your involvement biases you least.

The deeper point: an approval's value comes entirely from who gave it and what
they actually executed. An approval whose provenance is silently weaker than
it appears is worse than a delayed one, because it spends credibility that was
never earned.

Related: [[state-what-you-did-not-verify]].
