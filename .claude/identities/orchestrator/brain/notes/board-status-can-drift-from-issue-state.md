---
tags: [board, github-projects, audit]
paths: [".claude/**"]
strength: 1
source: "TAL-033 iteration (#117), reconciling stale #17"
graduated: false
created: 2026-07-19
---

A GitHub Project's custom Status field (Backlog/In progress/.../Deployed) is independent of
the underlying issue's open/closed state — closing an issue does NOT move its board Status.
The board audit does not currently check for this drift class (it only checks in-progress
items against local branches). Concretely: issue #17 (FAB-041) was CLOSED with an OWNER
comment explaining it was merged into FAB-040, but its board Status field was still
"Backlog", so the next-pick script surfaced it as the top pick. Before trusting a pick,
a quick sanity check (does the issue show read "[OPEN]" or "[CLOSED]"?) catches this; when
found, reconcile the Status field (closest matching status, e.g. Deployed) and comment the
reconciliation reason on the issue before moving on to the next candidate.
