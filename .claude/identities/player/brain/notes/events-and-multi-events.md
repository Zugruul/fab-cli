---
tags: [cr, events]
paths: []
strength: 1
source: "https://rules.fabtcg.com/txt/latest/en-fab-cr.txt (CR 1.9)"
graduated: false
created: 2026-07-10
entities: [card:blazing-aether, card:mark-of-the-beast, card:moon-wish, card:mordred-tide]

---

Events are the atoms of game-state change (CR 1.9). "Draw 3" is a MULTI-EVENT of three draws (1.9.2) — a trigger on "draws 1 or more cards" fires ONCE per multi-event, not per card (Valda, 1.9.2a); a replacement replaces the whole multi-event once (Mordred Tide gives X+1, not 2X, 1.9.2b). Do-nothing instructions don't happen at all: dealing 0 damage can't be modified upward or trigger anything (Blazing Aether at X=0, 1.9.1b). Private searches are "may fail to find" — opponents can't verify your deck, so you may whiff on purpose (Moon Wish, 1.9.1c). Named-events (discard, opt): replacing a component keeps the name — a discard replaced into banish still counts as a discard AND a banish for triggers (Mark of the Beast, 1.9.3a). Links: [[effects-optional-conditional-targeted]], [[second-cycle-awareness]].
