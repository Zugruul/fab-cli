---
tags: [spec, process]
paths: ["docs/spec-deltas/**", "SPEC*.md"]
strength: 1
source: "PR#53"
graduated: false
created: 2026-07-12
---

When a dev discloses a justified deviation from spec text, don't just accept it in review — require a spec delta file (docs/spec-deltas/<task>.md, final paste-ready wording) on the same branch, then fold it into the spec at the In-review→QA transition. The spec must always describe merged reality; a code comment claiming an exception is not a contract change.

Related: [[gate-ambient-contamination]]
