---
tags: [cr, properties]
paths: []
strength: 1
source: "https://rules.fabtcg.com/txt/latest/en-fab-cr.txt (CR 2)"
graduated: false
created: 2026-07-10
---

13 object properties (CR 2.0.1): abilities, color, cost, defense, intellect, life, name, pitch, power, subtypes, supertypes, text box, type. True text lives on cardvault.fabtcg.com (2.0.2) — matches [[card-corpus-and-search]]. BASE vs MODIFIED: "get/gain/have/lose" changes the modified value only; only "base" changes base (2.0.3a). No numeric property can go below 0 (2.0.3c). COST is special: it can never be modified — cost reduction/increase applies only during the play/activate calculation; effects reading "cost" see the unmodified property, effects reading "payment" see what was actually paid (2.2.4, 2.2.4b). Life: total = base + gained − lost; base-life changes recalculate the total keeping the delta (Shiyana copying Kano: 20→15 base with 5 lost = 10, CR 2.5.3c). Missing printed value = property absent entirely (0 is a valid printed value but no box = no property) — interacts with [[effects-optional-conditional-targeted]] property-existence conditions. Links: [[card-anatomy]], [[numbers-x-and-symbols]].
