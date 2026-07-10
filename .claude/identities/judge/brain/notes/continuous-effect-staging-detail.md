---
tags: [cr, adjudication, staging]
paths: []
strength: 1
source: "https://rules.fabtcg.com/txt/latest/en-fab-cr.txt (CR 6.3)"
graduated: false
created: 2026-07-10
---

Full staging algorithm (CR 6.3, deepens [[layers-and-continuous-effect-staging]]): rules-modifying effects first, simultaneously (Hypothermia-type "can't", 6.3.1); then object effects in 8 stages: 1 copyable / 2 controller / 3 name-color-text / 4 types-subtypes / 5 supertypes / 6 abilities / 7 BASE numeric values / 8 numeric values+counters. Dependent effects float UP to the stage they depend on (Thump: ability-granting but power-dependent → applied stage 8 substage 7, 6.3.2a). Substages within 7-8: add/remove property → set → multiply → divide → add → subtract → dependent (6.3.3). Same substage → timestamp order; same timestamp → turn-player decides, decision locks (6.3.4b). Dynamic recalc: an effect becoming applicable in a LATER stage joins (Minnowism after base-power reduction, 6.3.5a); earlier stages never re-open (6.3.5b). Removal effects don't strip other effects' additions (Erase Face vs Cinderclaw, 6.3.6); "can't gain" ≠ "loses" (6.3.7). Links: [[properties-base-vs-modified-rulings]], [[replacement-effect-ordering]].
