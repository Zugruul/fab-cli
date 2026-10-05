---
tags: [docs, claims, review]
paths: ["**"]
strength: 1
source: ""
learned-from: task 219 review nit
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Grepping changed files for PR-body claims catches "doc X notes Y" omissions, but NOT semantic overstatements: #219's PR body claimed "light-mode visual output is unchanged" while the diff darkened two text sites (#333333 → token 'text' = #000000). Claims of behavioral/visual equivalence ("unchanged", "no regression", "same as before") are the strongest claims a PR body makes — verify each one against the actual before/after values in the diff, or weaken the wording to match reality ("essentially unchanged; two gray text sites darken slightly"). Complements pr-body-claims-must-exist-in-committed-artifacts.
