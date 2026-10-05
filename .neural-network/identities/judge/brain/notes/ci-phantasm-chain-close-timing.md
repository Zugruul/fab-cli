---
tags: [card-interaction, phantasm]
paths: []
strength: 1
source: "CR 8.3.13a, 8.3.13b, 7.7.2c — third_party/fab-rules/en-fab-cr.txt; card: Coalescence Mirage (third_party/flesh-and-blood-cards)"
graduated: false
created: 2026-07-10
entities: [card:coalescence-mirage]

---

**Coalescence Mirage** (Illusionist Action Attack): "Phantasm — When Coalescence Mirage is destroyed, you may put an Illusionist aura card with cost 0 from your hand into the arena." Phantasm (CR 8.3.13) itself means "Whenever this is defended by a non-Illusionist attack action card with 6 or more {p}, destroy this."

Ruling — timing of the destroy relative to damage: CR 8.3.13b is explicit: "If an attack destroyed by phantasm before damage for its chain link has been calculated, the combat chain closes (CR 7.7.2). If an attack is destroyed by phantasm after damage for its chain link has been calculated, the combat chain does not close."

So whether phantasm ends the whole combat chain depends purely on WHEN the phantasm state-condition (defended by a 6+{p} non-Illusionist action card) is checked/resolves relative to the Damage Step (CR 7.5.2). If the defending card's power reaches 6+ only via an effect that resolves AFTER damage is calculated, Coalescence Mirage is destroyed post-damage and the chain link's own subsequent steps (and any queued attacks) continue normally — the attacker still gets to trigger its own "when this hits" text if it hit before being destroyed, and the Illusionist-aura-into-arena reflexive trigger from Coalescence Mirage's own destruction still fires either way.

See [[kw-phantasm]], [[combat-chain-steps]].
