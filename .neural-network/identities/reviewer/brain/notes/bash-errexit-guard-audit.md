---
tags: [review, bash, shell]
paths: ["scripts/**"]
strength: 1
source: "PR#89 review round 1 (TAL-001)"
graduated: false
created: 2026-07-18
---

Reviewing bash under `set -euo pipefail`: trace which statements are guarded (`if`, `||`, `2>/dev/null || true`) vs bare — bare mutating commands in loops are where mid-run crashes hide, especially repair/self-heal paths whose happy case never fails. Check `continue`+flag error accumulation actually reaches an end-of-run exit-code check.
