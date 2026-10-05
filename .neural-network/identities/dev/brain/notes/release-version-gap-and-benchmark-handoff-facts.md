---
tags: [eval, release, manifest-schema, benchmarks]
paths: ["pipeline/**"]
strength: 1
source: ""
learned-from: task 135
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Facts for APP-024 (benchmarks) and later release work: (a) @fab/manifest-schema has NO release-level version field (only schemaVersion + per-artifact version) — #135 invented --version/--previous-version CLI plumbing as the only convention; anything keying off candidate version hits the same gap, consider a schema-level release version field via a spec delta rather than more CLI plumbing. (b) Artifact durability split: eval-runs/ = gitignored/regenerable; pipeline/training-runs/ and pipeline/release-audits/ = committed provenance. §8.6 wants device benchmarks in the release manifest → committed class. (c) If §8.6 thresholds gate release (check exact spec wording), extend release.ts's checkReleaseGate with a new breach clause rather than building a parallel gate — checkReleaseGate is the single release-decision surface.
