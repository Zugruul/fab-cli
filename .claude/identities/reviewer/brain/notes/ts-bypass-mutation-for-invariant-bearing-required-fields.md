---
tags: [review, typescript, invariants, mutation]
paths: ["**"]
strength: 1
source: ""
learned-from: task 223 review
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

TypeScript "required" is compile-time only — a writer whose field carries a SPEC INVARIANT (manifest lineage, license id, checksum) can still silently emit undefined when called via `as any`, JS, or deserialized input. Review step for any manifest/config/record writer whose fields back an invariant: call it directly with the invariant field omitted/empty (TS-bypass) and demand a runtime throw; TS-level typing alone is a REQUEST_CHANGES-worthy gap there. Scope it to invariant-bearing fields — ordinary fields don't warrant runtime guards everywhere.
