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
items against local branches). Concretely: issues #17, #19, #20, #21 were CLOSED (OWNER
comments: merged elsewhere, or deliberately deferred per a spec section) but their board
Status was still "Backlog", so the next-pick script surfaced them as top picks one at a
time across sessions. Before trusting a pick, a quick sanity check (does the issue show
read "[OPEN]" or "[CLOSED]"?) catches this; when found, reconcile the Status field (closest
matching status, e.g. Deployed) and comment the reconciliation reason before moving on.

IMPORTANT — narrow the signature correctly: the actual bug is specifically **Backlog status
+ Closed issue** (abandoned before entering the pipeline, never got a PR). A closed issue
sitting at "In review"/"QA"/"Ready" is usually NORMAL, not stale — a PR body's "Closes #N"
auto-closes the issue on merge, well before the task's Status field reaches "Deployed" (which
requires a separate live-validation step). Don't blanket-reconcile every closed-issue item
you find — checked 8 such "Ready + Closed" items (#59, #83-88, #110) in this same session and
all were legitimately mid-pipeline, correctly untouched. Only "Backlog + Closed" is the drift
to fix.
