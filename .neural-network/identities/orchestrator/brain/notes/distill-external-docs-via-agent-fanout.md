---
tags: [brains, ingestion, agents, pattern]
paths: []
strength: 1
source: "loop-feedback 2026-07-11"
graduated: false
created: 2026-07-11
---

For long external documents that DON'T enumerate their own concepts (release notes, articles, prose rulings — contrast [[scripted-knowledge-ingestion]] for parseable corpora): fan out ONE distiller subagent per document, all in parallel, each returning a digest in a strict fixed format with a hard word cap (~600 words; sections like SET / NEW-MECHANICS / RULINGS / CHANGES / POSSIBLY-OUTDATED). The orchestrator mints a cited note per digest INCREMENTALLY as results arrive — this bounds orchestrator context, survives context compaction mid-run, and loses nothing if a later agent fails. Tell each agent its final message is raw data for the orchestrator, and to flag suspected-stale claims for the verification pass ([[verify-dated-sources-supersession]]) rather than resolving them itself.
