---
tags: [card-interaction, wager, overpower]
paths: []
strength: 1
source: "CR 8.5.46, 8.5.46a, 8.3.22a — third_party/fab-rules/en-fab-cr.txt; card: Betsy, Skin in the Game (third_party/flesh-and-blood-cards)"
graduated: false
created: 2026-07-10
---

**Betsy, Skin in the Game**: "Whenever an attack you control wagers, you may pay {r}{r}. If you do, the attack gets +1{p} and overpower."

Wager (CR 8.5.46) is a continuous effect: "when the chain link of the attack resolves, if the attack has hit, the controller wins the prize, otherwise the other player wins." CR 8.5.46a confirms the trigger ("whenever this wagers") fires when the wager effect is first generated (i.e. when the attacking card resolves and applies wager to itself), which happens BEFORE the Damage Step / hit is determined and, critically, AFTER the Defense Step has already closed (defending cards are already locked in — CR 7.0 combat chain step order: defend, then the attack layer/attack resolves and generates continuous effects like wager).

Ruling: because Betsy's overpower grant happens at the moment the attack itself resolves (post-defense-lock, per the combat chain step order), it can NEVER prevent a second action card from being added to defend THIS attack — that window already closed. Per CR 8.3.22a/b, the overpower granted this way is irrelevant to that swing's own defense; it only matters for interactions checking the attack's current keyword set afterward (e.g. a different card reading "if this attack has overpower..." later in the same chain link), not for gating defenders.

See [[kw-overpower]], [[kw-wager]].
