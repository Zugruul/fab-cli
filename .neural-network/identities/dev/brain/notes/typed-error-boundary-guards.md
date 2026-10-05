---
tags: [pricing, errors, parsing]
paths: ["src/pricing/**"]
strength: 1
source: "PR#55 review round 1"
graduated: false
created: 2026-07-12
---

A typed-error contract ("never a raw TypeError") is only as strong as the FIRST field access: guard the top-level payload shape (`raw == null || typeof raw !== "object"`) before touching any field. Malformed-payload tests that only remove specific keys from well-formed objects miss the null/array/primitive body case — always include one.

Related: [[untyped-api-optional-fields]] [[test-must-falsify]]
