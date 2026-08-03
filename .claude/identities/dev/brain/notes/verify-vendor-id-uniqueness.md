---
tags: [dataset, cache-keys, fab-cube, identifiers]
paths: ["pipeline/**", "fab-cli/third_party/**"]
strength: 1
source: "PR#235 APP-025 retro"
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Before keying a cache/label/file on a vendored-dataset identifier, verify its uniqueness against the actual data first. the-fab-cube's human-readable print code (e.g. MST131) is shared by 74 pairs of DIFFERENT cards (dual-faced/fusion entries); only printing.unique_id is collision-free (16,264/16,264 distinct, zero image-URL conflicts). Keying on the 'obvious' id would have silently conflated distinct card images.

Related: [[test-knob-intersections]]
