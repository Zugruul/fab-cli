---
tags: [card-interaction, mark]
paths: []
strength: 1
source: "CR 8.5.50, 9.3.2b, 9.3.3 — third_party/fab-rules/en-fab-cr.txt; card: Hunter's Klaive (third_party/flesh-and-blood-cards)"
graduated: false
created: 2026-07-10
entities: [card:hunters-klaive, card:marked]

---

**Hunter's Klaive** (Assassin Weapon Dagger 1H): "Once per Turn Action - {r}{r}: Attack. Go again. When this hits a hero, mark them. Piercing 1." Mark (CR 8.5.50): "To mark a hero, that hero has the marked condition." Marked (CR 9.3): a hero stays marked until hit by an opponent's source (9.3.2b), and CR 9.3.3 is precise: "When a marked hero is hit by a source controlled by an opponent, the marked condition of that hero is removed as part of the hit event."

Ruling: the removal in 9.3.3 happens "as part of the hit event" — but Hunter's Klaive's own mark-application is a SEPARATE triggered ability ("when this hits a hero, mark them") that goes on the stack and resolves AFTER the hit event completes. So for a hero being hit by Hunter's Klaive who was ALREADY marked (e.g. from an earlier attack this turn): the hit event itself clears the old marked condition (9.3.3) as part of the hit; then, afterward, Hunter's Klaive's own triggered ability resolves and marks them fresh (9.3.2a: re-marking an already-marked hero just continues the condition, but here it's freshly reapplied post-clear). Net result: the hero ends the combat still marked either way, and this holds true regardless of whether they walked in already marked — the clear-then-reapply sequence produces the same end state, so judges should not assume Klaive's own hit "fails" to mark just because the hit event notionally clears marked first.

See [[kw-mark]].
