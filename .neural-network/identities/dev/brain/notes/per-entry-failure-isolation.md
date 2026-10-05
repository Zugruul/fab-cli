---
tags: [pipelines, robustness, symlinks]
paths: []
strength: 1
source: "APP-010 PR#173 review"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Batch ingestion pipelines must isolate failures at EVERY granularity: one bad entry (broken symlink, corrupt JSON, unreadable file) must skip-with-recorded-reason, never crash its source or the run. Surface skipped counts+reasons in the output manifest (never silent). Also: directory walks filtering entry.isFile() silently DROP broken symlinks — yield symlink dirents too so failures are attempted and recorded, not invisible. Guard every per-entry op: realpath, read, parse.
