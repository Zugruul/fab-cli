---
tags: [review, citations, docs, verification]
paths: ["docs/**", "test/**"]
strength: 1
source: "PR#95 (TAL-010) spec-compliance review"
graduated: false
created: 2026-07-18
---

For citation-heavy documents, spot-check by grepping the actual current file for the exact quoted string/line/function name — this catches drift that a plausibility read misses. When a citation looks off, trace it back one more hop before calling it fabricated: it may be copy-forwarded from an upstream doc's own (now-stale) claim rather than invented, which changes how you flag it. For PR-number citations, `gh pr view <n> --repo <org>/<repo> --json title,state,mergedAt,author,reviews` confirms merged/title/author in one call; save `gh pr diff --name-only` specifically for claims like "touches exactly N files", since undercounting/overcounting file lists is the easy way to get a true-but-imprecise citation.

Related: [[docs-only-pr-verify-claims-against-source]] (claim-inventory approach for automation-describing docs; this note is the vendored-file-path/PR-citation variant of the same discipline).
