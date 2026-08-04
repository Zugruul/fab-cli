---
tags: [schemas, design, grounding]
paths: ["packages/**", "pipeline/**", "fab-app/**"]
strength: 1
source: "PR#248 APP-024 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

Before designing a schema field, open the CONSUMER/producer code that will carry it — the required-vs-optional answer usually already exists there. PR#248: modelPackAssembler takes evalScores as plain-required with no fallback; a required benchmarkResults would have broken it and forced scope creep into an explicitly-off-limits file. Seen by opening the assembler first, not by abstract reasoning.

Related: [[read-producers-real-bytes-before-fixtures]] [[shared-schema-diff-sibling-protocols]]
