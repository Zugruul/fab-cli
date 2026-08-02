---
tags: [theming, wcag, colors]
paths: ["fab-app/**"]
strength: 1
source: ""
learned-from: task 219
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

"Standard" platform colors fail WCAG AA (4.5:1) against white out of the box: iOS system blue #0a84ff is 3.65:1 and GitHub-amber-style #b58900 is 3.21:1. fab-app darkened them to #0968d6 / #916c00 to pass. Before reaching for a conventional platform color as an accent/warning/status tone in any future screen, run it through the repo's contrast function (fab-app/src/theme/contrast.ts) against both themes' background AND surface — the token-contrast gate will fail the merge anyway, so check first. Related audit default: multiple near-identical ad hoc hexes (#333/#555/#666/#888) usually signal NO real design intent — consolidate into one semantic role rather than minting a role per hex.
