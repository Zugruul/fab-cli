---
tags: [review, content, datasets, verification]
paths: ["**"]
strength: 1
source: ""
learned-from: task 134 review
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Reviewing a committed content dataset (transcribed eval items, seeded KB entries): sample sqrt(N) rounded up (min 5, cap ~10) with a FIXED random seed (reproducible), STRATIFIED across every source file/batch (padding one file is the cheat this catches). Per sampled item: fetch the ACTUAL cited source (never a vendored copy the dev could have edited) and read the whole doc, not a grep hit. Violation tiers: one item asserting what the source doesn't say → REQUEST_CHANGES that item; invented/altered numeric or scenario details → same but severer (paraphrase-without-checking signal); 2+ violations in the sample, or any violation of a claim the PR body called "verified" → hard fail (the verification claim itself was false). Zero violations = report "spot-checked N/Total, all faithful" — evidence, never "verified faithful".
