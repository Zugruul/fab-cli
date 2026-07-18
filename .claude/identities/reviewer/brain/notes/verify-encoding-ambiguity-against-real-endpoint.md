---
tags: [review, http, verification]
paths: ["src/**"]
strength: 1
source: "PR#104 (FAB-024) code-quality review round 1"
graduated: false
created: 2026-07-18
---

When a reviewer flags a query-encoding ambiguity (e.g. does an API accept %20 vs + for spaces in a search param) as worth checking, independently hitting the REAL live endpoint with both encodings and comparing actual responses is decisively better than reasoning from RFC 3986 or documentation alone — settles the question with certainty in one cheap live request instead of leaving it as an assumption in the review report. Done on PR#104 (FAB-024): confirmed both encodings return identical results from the real fabtcg.com WP API.

Related: [[reproduce-gate-claims]]
