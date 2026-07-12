---
tags: [testing, tdd]
paths: ["test/**"]
strength: 1
source: "PR#53 review round 1"
graduated: false
created: 2026-07-12
---

A test only counts if it FALSIFIES the behavior it names: pick fixture data where the guarded path actually diverges from the unguarded one. PR#53's "trend 0 is not no-data" test used a row whose trend was nonzero — it passed with or without the guard. Ask: "if someone deletes the code under test, does this test fail?"

Related: [[untyped-api-optional-fields]]
