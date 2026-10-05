---
tags: [integration, cli, testing]
paths: ["pipeline/**"]
strength: 2
source: "PR#255 #253 retro (escalated re-mint)"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-04
---

Green unit tests over self-shaped fixtures never cross integration seams — run the REAL entry point against real data before done. ESCALATED by PR#255: both real-run bugs (16k-download pool scope; duplicate two-player scene) were STRUCTURALLY INVISIBLE to unit tests — one-candidate pools make picks==pool tautological, tiny catalogs make duplicates unremarkable. Not carelessness: no amount of unit rigor could catch them. The real run is a hard deliverable, never a nice-to-have. (Also PR#243: 2 bugs; PR#246: EXIF verification.)
