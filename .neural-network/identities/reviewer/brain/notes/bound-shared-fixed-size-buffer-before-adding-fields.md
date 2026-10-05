---
tags: [review, capacity, buffers, talishar]
paths: ["third_party/talishar/**"]
strength: 1
source: "TAL-032 (#116) PR#118 code-quality review"
graduated: false
created: 2026-07-19
---

When a code change adds a new field to a fixed-size shared buffer/cache row (e.g. a
128-byte shmop segment holding many unrelated pieces of state), always compute the
realistic TOTAL byte budget — existing fields' typical sizes plus the new field's
worst-case size — not just "does my one new field look small." A ~36-char UUID looked
harmless in isolation but pushed an already ~103/128-byte row over budget on the very
first exchange, and the underlying write function (`shmop_write` after `str_pad`) had
no bounds check, so the overflow silently truncated and corrupted the ENTIRE row
(every other field sharing that segment), not just the new one. This class of bug is
easy to miss because the new field's own diff looks completely reasonable; catching it
requires reconstructing what a realistic pre-existing payload looks like and doing the
actual arithmetic. Found via TAL-032's PR #118 code-quality review.
