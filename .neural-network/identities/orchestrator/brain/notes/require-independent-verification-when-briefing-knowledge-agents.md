---
tags: [briefing, verification, knowledge-base]
paths: ["**"]
strength: 1
source: "talishar brain re-seed (PR#119)"
graduated: false
created: 2026-07-19
---

When briefing an agent to correct/extend a knowledge base against a live, ground-truth
source (vendored code, external docs), explicitly requiring independent verification of
every claim in the brief — not just trusting the briefer's own research summary as fact —
costs little extra and can surface genuinely new findings beyond the enumerated scope. In
the talishar brain re-seed (PR#119), a dev agent instructed this way found and documented a
real, previously-unknown issue (three independent, potentially-colliding uses of the same
shared-state slots) that wasn't in the original brief at all — it only surfaced because the
agent read the real files itself rather than transcribing what it was told to look for.
