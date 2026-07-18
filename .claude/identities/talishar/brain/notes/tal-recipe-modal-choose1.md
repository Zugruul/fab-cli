---
tags: [talishar, recipe, modal, decision-queue]
paths: []
strength: 1
source: "third_party/talishar/CLAUDE.md; Talishar/Talishar#1370; third_party/talishar/DecisionQueue/AwaitEffects.php"
graduated: false
created: 2026-07-18
entities: [card:astral-strike]
---

For a "choose 1 of N" modal effect (a card whose resolution presents the player with several
named modes, e.g. "Draw a card / Buff power / Go again"), the established recipe is exactly three
pieces used together, confirmed against the real merged `Talishar/Talishar#1370`:

1. A `BUTTONINPUT` DQ carrying the comma-separated mode names as its parameter (e.g.
   `AddDecisionQueue("BUTTONINPUT", $this->controller, "Draw_a_Card,Buff_Power,Go_Again")`),
   preceded by a `SETDQCONTEXT` DQ for the UI helper text and followed by a `SHOWMODES` DQ so the
   frontend actually renders the modal prompt (not just a generic button list).
2. `Await($this->controller, $this->cardID, final:true)` immediately after — routes the chosen
   button's value to `$dqVars["LASTRESULT"]` and, because `$final=true`, clears `$dqVars` once this
   Await resolves so a later Await in a different sequence doesn't read stale state.
3. A `TRIGGER` layer pushed from `SpecificLogic()` (not resolved inline), reading the chosen mode
   from `$dqVars["LASTRESULT"]`: `AddLayer("TRIGGER", $this->controller, $this->cardID,
   additionalCosts:$dqVars["LASTRESULT"])`. The actual per-mode effect then lives in
   `ProcessTrigger()`, branching on `$additionalCosts` — see [[tal-recipe-base-card]] for the full
   `astral_strike_red` skeleton this pattern comes from.

**Why route through a `TRIGGER` layer instead of applying the effect directly inside
`SpecificLogic()`?** Keeping resolution on the layer stack (see
[[tal-arch-layer-stack-combatchain]]) preserves correct ordering relative to other pending
triggers/abilities — resolving inline in `SpecificLogic()` would apply the effect immediately,
out of band with the stack, which is wrong if something else is also queued to resolve first.

This is Astral Strike's whole shape — a ClassState-gated 3-mode choice
([[tal-recipe-classstate-counter]]) whose chosen mode grants either a one-shot effect (`Draw a
card`) or a suffixed continuous combat effect (`Buff_Power`/`Go_Again`, see
[[tal-recipe-currentturneffect-suffix]]).
