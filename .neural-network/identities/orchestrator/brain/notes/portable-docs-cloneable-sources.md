---
tags: [docs, portability, setup]
paths: []
strength: 1
source: "remote-compute-setup runbook correction (user, 2026-08-02)"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Docs that set up anything (runbooks, READMEs, skills) must be executable from a bare clone on a machine that has nothing else: every companion repo or tool gets its cloneable URL plus a reader-chosen path variable (git clone <url>; export TOOL=<path>), never an absolute path from the authoring machine. The authoring machine's layout is invisible state — a doc referencing it works exactly once, for exactly one person. User-corrected on the remote-compute runbook; check for this before committing any setup doc: grep it for '~/' and '/Users/' outside of REMOTE-machine examples.
