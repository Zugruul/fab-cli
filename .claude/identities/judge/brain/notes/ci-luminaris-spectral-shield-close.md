---
tags: [card-interaction, phantasm, attack-proxy]
paths: []
strength: 1
source: "CR 7.7.2c (worked example) — third_party/fab-rules/en-fab-cr.txt; cards: Luminaris, Spectral Shield (third_party/flesh-and-blood-cards)"
graduated: false
created: 2026-07-10
entities: [card:spectral-shield]

---

**Luminaris** (Light Illusionist Weapon Scepter 2H): "During your action phase, Illusionist auras you control are weapons with 1 base {p} and 'Once per Turn Action - 0: Attack.'" **Spectral Shield** (Illusionist Token Aura): "Ward 1." Activating a Spectral Shield token's granted attack ability turns it into an attack-source.

This exact interaction is the CR's own worked example under CR 7.7.2c (Close Step — "if, before damage is calculated during the Damage Step, the active-attack ceases to exist and there are no more attacks in the queue, the Close Step begins as a game state action"): "If a Spectral Shield token is activated to attack the opponent, and the token is destroyed before the Damage Step, the activated attack will also cease to exist, and the Close Step will begin."

Ruling: Spectral Shield's Ward 1 is destroy-the-object-to-prevent-damage (CR 8.3.20) — if the opponent deals damage to the Spectral Shield attacker BEFORE its own Damage Step (e.g. an instant that damages the attacking permanent in response), the token is destroyed, its granted attack ceases to exist as its source is gone, and per 7.7.2c the combat chain closes immediately if no other attacks are queued — the Spectral Shield's own attack never deals its damage.

See [[kw-token-spectral-shield]], [[combat-chain-steps]].
