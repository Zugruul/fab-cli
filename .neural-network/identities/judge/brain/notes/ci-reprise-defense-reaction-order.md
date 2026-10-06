---
tags: [card-interaction, reprise]
paths: []
strength: 1
source: "CR 8.4.3, 8.4.3a, 8.1.3b, 7.4.2b — third_party/fab-rules/en-fab-cr.txt; cards: Ironsong Response, Beneath the Surface (third_party/flesh-and-blood-cards)"
graduated: false
created: 2026-07-10
entities: [card:beneath-the-surface, card:ironsong-response]

---

**Ironsong Response** (Warrior Attack Reaction): "Reprise — If the defending hero has defended with a card from their hand this chain link, target weapon attack gains +3{p}." Reprise (CR 8.4.3): a label for a resolution ability typically written as "Reprise - If the defending hero has defended with a card from their hand this chain link, [EFFECTS]." CR 8.4.3a is explicit: "The condition of a reprise ability effect is checked on resolution - it does not retroactively generate effects if the condition is met after resolution."

Attack Reaction cards like Ironsong Response can only be played during the Reaction Step (CR 8.1.2a, 7.4.2a). A Defense Reaction card (e.g. **Beneath the Surface**) can also be played during that same Reaction Step (CR 7.4.2b, 8.1.3a) and — critically — CR 8.1.3b: "When a defense reaction card resolves as a layer on the stack, it becomes a defending card on the active chain link." So if the defending hero declared NO hand-card defenders during the earlier Defend Step, they can still satisfy Ironsong Response's Reprise condition by playing a Defense Reaction during the Reaction Step — but ONLY if that Defense Reaction resolves and becomes a defending card BEFORE Ironsong Response itself resolves.

Ruling: because the stack resolves LIFO, whichever of the two reaction cards is played SECOND (in response to the first) resolves FIRST. If the attacking player plays Ironsong Response and the defending player responds by playing their Defense Reaction, the Defense Reaction resolves first (becoming a defending card per 8.1.3b), so by the time Ironsong Response resolves the condition IS met and the weapon attack gets +3{p}. If instead the defending player's Defense Reaction had already resolved earlier (or they choose not to respond at all), and Ironsong Response resolves with no hand-card defender yet on the chain link, the condition is false at that moment — and per 8.4.3a this is final: even if a Defense Reaction is played and resolves immediately afterward, Ironsong Response's bonus is NOT retroactively granted. The order of resolution within the Reaction Step, not just what eventually defends the chain link, decides the outcome.

See [[kw-attack-reaction]], [[kw-defense-reaction]].
