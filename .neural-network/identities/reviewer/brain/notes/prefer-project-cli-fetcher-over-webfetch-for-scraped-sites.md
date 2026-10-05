---
tags: [review, fetching, fab-cli]
paths: ["**"]
strength: 1
source: ""
learned-from: task 134 review
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

fabtcg.com (WordPress REST API) 403s WebFetch's plain fetch — same bot-protection pattern as tcgcsv/TCGplayer storefront documented in fab-cli's CLAUDE.md. When verifying content sourced from a site the project's own CLI already scrapes, run the CLI's own fetch path (e.g. `fab-cli rules sync`) instead of WebFetch: it carries the right headers, and it exercises the same code path production users hit rather than a side channel. Restore any vendored files the CLI's sync touches (e.g. third_party/fab-rules/VERSIONS.txt) before reporting.
