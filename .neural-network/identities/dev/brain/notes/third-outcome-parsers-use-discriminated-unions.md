---
tags: [typescript, parsers, api-design]
paths: ["**"]
strength: 1
source: ""
learned-from: task 135
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

When a parser/extractor needs a third distinct outcome (e.g. "ambiguous" alongside found/not-found), reach for a discriminated union ({kind: "none"|"single"|"ambiguous", ...}) over sentinel values or a widened nullable — the caller gets exhaustive branching and distinct user-facing messages for free, and the type system enforces handling the new case everywhere. #135's audit-verdict fix needed exactly this (nullable string couldn't distinguish "incomplete" from "conflicting").
