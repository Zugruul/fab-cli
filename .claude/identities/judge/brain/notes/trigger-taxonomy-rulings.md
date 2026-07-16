---
tags: [cr, adjudication, triggers]
paths: []
strength: 1
source: "https://rules.fabtcg.com/txt/latest/en-fab-cr.txt (CR 6.6)"
graduated: false
created: 2026-07-10
entities: [card:bloodrot-trap, card:hyper-driver]

---

Trigger taxonomy (CR 6.6, deepens [[triggered-effects-and-ordering]] and [[missed-trigger-timing-windows]]): INLINE ("When [condition], [effect]" inside a resolution) — discrete, only when generated, though it's the one type that can fire on an already-met condition (6.6.5a exception). DELAYED ("the next time…") — layer-continuous, duration required unless phase/step-bound (6.6.3a). STATIC-triggered ("Whenever…") — lives while the ability is functional. Event-triggers need the event to still match after replacements (6.6.5b, Bloodrot Trap's compound event+state condition); state-triggers fire on entering the state, or immediately if generated inside it (Hyper Driver at 0 counters, 6.6.5c); ordinals are duration-relative and can be pre-spent before the source arrives (6.6.5d); over-limit triggers create no layer; PREVENTED triggers still count against limits (Katsu/Tripwire, 6.6.5f). Targetless triggered-layers cease instead of stacking (6.6.6a). Multi-trigger ordering: turn-player picks starting player; each owner orders their own (6.6.6b). Links: [[layers-and-continuous-effect-staging]], [[abilities-functionality-rulings]].
