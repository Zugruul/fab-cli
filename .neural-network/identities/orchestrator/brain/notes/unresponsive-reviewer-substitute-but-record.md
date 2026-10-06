---
tags: [review, independence, agents, process, honesty, provenance, message-loss]
paths: []
strength: 2
source: ""
confidence: direct
learned-from: task 256, 2026-08-04 — original note's premise was itself wrong; corrected
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# A silent reviewer may be a lost message, not a dead agent — verify before substituting

When a reviewer produces no output, the tempting inference is "it died, I'll do
it myself." **Check that inference before acting on it**: agent messages can be
delayed or lost in delivery, and a completed review can look identical to an
absent one from the orchestrator's side.

Worked example (the correction that produced this note): a reviewer showed no
worktree activity for 15+ minutes and didn't answer a ping. The orchestrator
declared it unresponsive, performed the review itself, merged, and recorded an
independence caveat on the PR. The reviewer had in fact **completed a full
review and sent it** — the message was lost. Its report arrived after the
merge, with several EXECUTED verifications the orchestrator had not done
(a mutation-tested safety margin, an end-to-end CLI determinism check) and
counter-evidence that **corrected one of the orchestrator's own filed claims**.

No harm resulted here — the verdicts agreed — but the PR carried a false
statement that the review was non-independent, and that had to be corrected
publicly.

**Practice:**
1. **Ping and wait through at least one more cycle** before concluding an agent
   is dead. Silence is weak evidence.
2. Distinguish "no output produced" from "no output received." Check for
   side-effects the agent would have left (files, runs, git state) — absence of
   *those* is much stronger evidence than absence of a message.
3. If you substitute, say **"I have not received a report"**, not "the reviewer
   stopped responding" — the first is what you actually know.
4. If the report later arrives, **correct the record where the claim lives**,
   not only in chat.

Deeper point: an approval's value comes from who gave it and what they
executed. Misattributing provenance — in either direction — corrupts that,
and the version that overstates your own contribution is the easier mistake to
make.

Related: [[state-what-you-did-not-verify]].
