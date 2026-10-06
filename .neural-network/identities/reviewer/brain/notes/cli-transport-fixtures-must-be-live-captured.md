---
tags: [review, cli-transport, fixtures]
paths: ["**"]
strength: 1
source: ""
learned-from: task 223 review
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Reviewing CLI-transport integrations (vs SDK clients) needs two extra checks: (a) usage/cost field semantics — a CLI's JSON output is an external versioned contract trusted blind; ask "does the mapped field mean what the code assumes" (input_tokens excluding cache reads was exactly such a finding) even when the code isn't wrong, just incomplete; (b) fixture realism — the fixture stands in for an entire external binary's contract, not one method's return type, so "was this fixture shape captured from a LIVE run" is a standing question; a hand-invented error shape can make the whole error-path suite vacuously green.
