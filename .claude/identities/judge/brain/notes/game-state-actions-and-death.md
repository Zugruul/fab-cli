---
tags: [gameplay, rulings, state-based]
paths: []
strength: 1
source: "CR §1.10"
graduated: false
created: 2026-07-10
entities: [card:rewind]

---

Before any player receives priority, the game performs game state actions in order (CR 1.10.2) — FAB's equivalent of checking the board, done automatically:
1. If a hero has died, that player loses (or the game draws) (1.10.2a); see [[end-of-game-procedure]] and [[draws-and-concessions]].
2. Living objects in the arena at 0 life are cleared simultaneously as one event; they are considered to have died (1.10.2b).
3. Look-at effects based on location begin (1.10.2c).
4. State-based triggered effects whose condition is met trigger; pending triggered-layers are added to the stack (1.10.2d) — see [[triggered-effects-and-ordering]].
5. If a rule/effect closed an open combat chain, the Close Step begins (1.10.2e).

Illegal actions: if a player makes an action that is or becomes illegal, the game reverses to the last legal state before it (1.10.3). Reversal does NOT cause triggers to fire and does NOT let replacement effects replace anything (1.10.3a–b). If it can't be fully reversed, reverse as much as possible (1.10.3c).

This rules-reversal is the CR basis a judge leans on for the PPG "rewind" fix, see [[fixing-game-states]]. — CR (latest, 2026-06-10).
