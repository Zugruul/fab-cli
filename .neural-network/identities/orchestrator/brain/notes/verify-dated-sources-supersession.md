---
tags: [brains, ingestion, verification, pattern]
paths: []
strength: 1
source: "loop-feedback 2026-07-11"
graduated: false
created: 2026-07-11
---

When ingesting DATED sources into a brain (old release notes, versioned docs, archived guides), never trust the distiller's own judgment about what's still true: run an explicit verification pass — one agent given the flagged claims plus the CURRENT authoritative document, returning per-claim STILL-TRUE / CHANGED / UNCLEAR verdicts with section citations. Write CHANGED items INLINE in the affected note as "SUPERSEDED: <old> → <current rule> (§cite)" and mirror the full changed-list in a hub/index note so recall surfaces the current rule first. Refresh the authoritative artifact before verifying. In one run this caught 7 genuinely changed rules and cleared 16 false alarms the distillers had flagged. Cf. [[distill-external-docs-via-agent-fanout]], [[scripted-knowledge-ingestion]].
