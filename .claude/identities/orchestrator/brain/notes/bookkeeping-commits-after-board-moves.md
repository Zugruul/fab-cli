---
tags: [process, gate, board]
paths: []
strength: 1
source: "BUG-199 iteration (re-gate after retro commit)"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Under the recorded-gate-pass-per-tree model, ANY commit on the primary checkout — including orchestrator bookkeeping (retro notes, feedback archives) — invalidates the recorded pass, and the next In-review move costs a full re-gate. Sequence accordingly: finish every pending board transition that depends on the current recorded pass BEFORE landing bookkeeping commits on main, and batch bookkeeping into one commit per boundary instead of sprinkling them between moves. (Root fix — per-lane gate pass — is an upstream plugin item; until it lands, ordering is the mitigation.)
