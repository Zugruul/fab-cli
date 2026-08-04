---
tags: [review, schemas, versioning]
paths: ["pipeline/**", "packages/**"]
strength: 1
source: "PR#246 #244 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

When a PR bumps a SCHEMA_VERSION-style constant, grep the whole tree for references: a version constant appearing in <=1 place (its own export) is DECORATIVE — documents intent, enforces nothing. A real bump needs (a) a persisted field carrying the value somewhere a consumer reads, and (b) a test pinning field == constant. Mirror the codebase's existing working example (benchmark/manifest.ts labelSchemaVersion) rather than accepting a comment-only bump.

Related: [[grep-central-nouns-across-pr]] [[execute-load-bearing-mechanism-claims]]
