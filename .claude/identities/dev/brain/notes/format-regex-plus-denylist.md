---
tags: [validation, licensing, testing]
paths: []
strength: 1
source: "APP-016 PR#175 rounds 1-2"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

A format regex alone cannot reject placeholder words that are format-valid (TODO passes any identifier-shaped regex just like MIT does). For compliance-bearing string fields, pair the format check with a documented denylist of known placeholders (TODO/TBD/FIXME/UNKNOWN/N-A/NONE, case-insensitive) and test both rejection classes: prose ('see LICENSE file') and format-valid placeholders ('TODO'). State the denylist's reasoning in a comment so it doesn't look arbitrary.
