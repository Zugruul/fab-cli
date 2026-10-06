---
tags: [review, testing, rigor]
paths: ["test/**"]
strength: 1
source: "PR#101 (TAL-012) code-quality review"
graduated: false
created: 2026-07-18
---

When reviewing a structural test against a config/data file, explicitly reward assertions that check a key's ABSENCE (e.g. asserting a models: key is NOT present), not just that present keys have correct values -- an absence check is exactly the kind of thing a lazy or shape-only implementation skips, and a test suite that only validates presence would silently accept a wrong value there.
