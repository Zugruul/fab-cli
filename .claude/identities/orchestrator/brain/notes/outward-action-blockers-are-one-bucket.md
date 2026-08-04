---
tags: [briefing, permissions, delegation]
paths: [".claude/**"]
strength: 1
source: "PR#243 APP-029 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

When a brief authorizes an outward-facing action conditionally, name credentials AND environment/tooling permission as ONE bucket with ONE instruction: attempt once, document-and-stop on any blocker, no workarounds. PR#243's dev spent real effort proving credentials were fine before hitting a runtime permission classifier the brief never named, then had to self-justify not routing around it. The correct behavior happened, but the brief should have made it the plain expected case.

Related: [[briefs-state-conventions-not-file-targets]] [[completion-report-is-part-of-done]]
