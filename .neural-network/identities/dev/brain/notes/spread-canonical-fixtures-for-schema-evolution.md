---
tags: [testing, fixtures, schema]
paths: []
strength: 1
source: "PR #212 / BUG-202"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Test fixtures that SPREAD one canonical valid fixture (…validKnowledgePackManifest, override one axis) instead of hand-building literals make schema evolution nearly free: when BUG-202 added a required per-file sizeBytes to the knowledge-pack index schema, every downstream consumer across four test suites stayed green untouched because they all spread the central fixture — only the fixture itself and the deliberately-invalid variants needed edits. When adding a required field to a schema, check consumers' fixture style first: spread-based consumers need zero changes; hand-rolled literals each become a breakage site. Write new tests spread-based for the same reason.
