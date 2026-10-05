---
tags: [handoff, process, consent]
paths: []
strength: 1
source: "session-close 2026-08-02"
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

When ending a long session deliberately (context reset, handoff), write ONE authoritative handoff file before stopping: exact in-flight branches/worktrees, unresolved diagnostics stated as unresolved, process contracts, a numbered first-actions list — and EXPLICITLY list session-scoped authorizations (e.g. merge consent) as EXPIRING so the next session re-asks instead of assuming. Declare the file authoritative over memory. Expect stop-condition hooks to fight a deliberate wind-down; satisfy them mechanically (re-arm the loop) rather than abandoning the handoff.
