---
tags: [gameplay, rulings, effects, layers]
paths: []
strength: 1
source: "CR §6.2, §6.3"
graduated: false
created: 2026-07-10
---

When two or more continuous effects modify an object at once, FAB resolves the order with the staging system (CR 6.3.1) — use this for "which +power applies first" disputes. Effects that modify the RULES of the game apply simultaneously BEFORE effects that modify objects (6.3.1).

Stage order (6.3.2), applied ascending:
1 copyable properties · 2 controller · 3 name/color/text box · 4 types/subtypes · 5 supertypes · 6 abilities · 7 base values of numeric properties · 8 counters + non-base numeric values.

A dependent effect (whose result would change if another same-or-higher stage effect applied first) is applied at the highest stage it depends on (6.3.2a–b).

Within stages 7–8, substage order (6.3.3): 1 add/remove property · 2 set · 3 multiply · 4 divide · 5 add · 6 subtract · 7 dependent. Ties broken by timestamp (6.3.4); same-timestamp ties broken by the turn-player (6.3.4b).

Effects apply dynamically and recalculate when the set changes (6.3.5). Removal effects don't strip properties added by other effects (6.3.6). Distinct from one-time event replacement ([[replacement-effect-ordering]]) and from stack resolution of triggers ([[triggered-effects-and-ordering]]); the turn-player breaking same-timestamp ties parallels priority in [[priority-and-the-stack]]. — CR (latest, 2026-06-10).
