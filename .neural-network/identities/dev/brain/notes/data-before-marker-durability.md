---
tags: [pipelines, durability, resumability]
paths: []
strength: 1
source: "APP-011 PR#177 review"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

In any resumable batch pipeline, persist the DATA durably BEFORE the done-marker, never after: marker-first ordering turns a mid-batch crash into permanent silent loss (resume skips the chunk; output never landed). Correct crash semantics = reprocess-one-chunk, achieved by: durable/awaited data write -> then progress mark, with last-write-wins dedupe so reprocessing can't duplicate. Test with a kill-simulation (throw right after the data write) proving resume regenerates and ends with exactly one record. Fire-and-forget stream writes are not durability.
