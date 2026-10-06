---
tags: [review, verification, engine]
paths: ["third_party/talishar/**"]
strength: 1
source: "PR#109 (TAL-021) spec-compliance review"
graduated: false
created: 2026-07-18
---

For game-engine-style implementations, grep the actual function signature and read how EXISTING callers use it before trusting that your own call 'looks right' -- a call with unusual-looking arguments (e.g. a function invoked with zero args when you'd expect one) can be a correct, common, well-established pattern rather than a mistake; only checking real call sites resolves the ambiguity either direction (confirms it's fine, or catches a real bug) rather than guessing from the signature alone.
