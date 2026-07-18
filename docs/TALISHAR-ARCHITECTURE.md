# Talishar Architecture

This is a deep-dive, cited reference for the three vendored [Talishar](https://talishar.net/)
repositories fab-cli uses as development aids for contributing card implementations upstream
(`third_party/talishar` — the PHP game engine; `third_party/talishar-fe` — the Vite+React SPA;
`third_party/talishar-cardimages` — the image pipeline). See `CLAUDE.md`'s "Talishar" section for
the vendoring/fork contract and `SPEC-TALISHAR.md` for the full spec this doc satisfies (§7).

**Citation rule (§7.1a):** every architectural claim below cites either a vendored file path in
backticks (e.g. `` `third_party/talishar/Constants.php` ``) or an upstream PR/issue reference
(e.g. `Talishar/Talishar#1370`). A claim that can't be grounded that way is omitted rather than
left uncited. Paths are relative to the fab-cli repo root; the clones are gitignored working
copies (§10 I3) — nothing under `third_party/talishar*` is ever committed here.

**This is a living document.** The vendored clones move fast (dozens of merged PRs a week); a
citation here is accurate as of the commit it was verified against, not a permanent guarantee.
Refresh sections that look stale during `/talishar-fork-sync` runs (§11 of the spec).

## Curated references

This long-form narrative has six condensed, quick-lookup companions under `.claude/talishar/`
(§7.5/§7.5a of the spec) — load these instead of this whole document for active Talishar work:

- `.claude/talishar/architecture.md` — engine pipeline + state model, condensed from the sections
  below.
- `.claude/talishar/card-recipe.md` — the self-sufficient card implementation recipe (full `Card`
  class skeleton + hook signatures + ClassState dance), expanding on "Card Recipe: A Worked
  Example" below.
- `.claude/talishar/decision-queue.md` — the full DQ verb list and Await function catalog, in more
  operational depth than "DecisionQueue & Await Async Model" below.
- `.claude/talishar/frontend.md` — SSE state flow, `ParseGameState.ts`, reconnect/watchdog
  behavior, expanding on "Frontend State Flow" below.
- `.claude/talishar/dev-stack.md` — bootstrap, compose services, ports, Xdebug, known gotchas,
  expanding on "Local Dev Stack" and "Known Stale Upstream Docs" below.
- `.claude/talishar/contributing.md` — fork contract, PR conventions, Discord coordination, and the
  I1/I2 invariants verbatim, expanding on "Upstream Contribution Conventions" below.

## Engine Request Pipeline

Every player action reaches the PHP backend as an HTTP request and flows through a fixed pipeline
before a response is serialized back to the frontend. The backend's own `CLAUDE.md` documents this
as: `ProcessInput.php` / `ProcessInputAPI.php` (validates and routes input) → `ParseGamestate.php`
(loads state from `./Games/{gameName}/GameFile.txt`) → `GameLogic.php` / `CardLogic.php` / the
per-type ability files (executes game rules) → `WriteGamestate.php` (persists state back to the
file) → `GetNextTurn.php` → `BuildGameState.php` (serializes the JSON response) — cited at
`` `third_party/talishar/CLAUDE.md` `` (its "Architecture" section) and confirmed directly:
`` `third_party/talishar/ProcessInput.php` `` (lines 1–46) validates `gameName`, `playerID`,
`authKey`, and `mode` as GET parameters before including `GameLogic.php`; `` `third_party/talishar/WriteGamestate.php` ``
opens `./Games/{gameName}/gamestate.txt` with `flock(LOCK_EX)`, truncates and rewrites it, then
calls `WriteGamestateCache()` to also populate the read-through cache (see "GameFile State Format
& Lifecycle" below); `` `third_party/talishar/BuildGameState.php` `` line 7 defines
`BuildGameStateResponse($gameName, $playerID, $authKey, ...)`, the function both `GetNextTurn.php`
and the SSE endpoint call to serialize the outbound JSON.

There are two delivery mechanisms for state back to the client:

- `` `third_party/talishar/GetNextTurn.php` `` — a thin polling endpoint; its own header comment
  says "the primary game state delivery mechanism is now SSE (`GetUpdateSSE.php`)... This endpoint
  remains for backwards compatibility and fallback scenarios."
- `` `third_party/talishar/GetUpdateSSE.php` `` — the live path (see "Frontend State Flow" below):
  a long-running `while (true)` loop that polls the gamestate cache every 50–150ms
  (`$sleepMs`, adaptive based on time since the last change) and pushes a `data:` SSE frame only
  when the cache's update counter advances.

## GameFile State Format & Lifecycle

Game state is **file-based, not database-driven** (`` `third_party/talishar/CLAUDE.md` ``,
"Project Overview"). Each game gets a directory `./Games/{gameName}/` containing
`GameFile.txt`/`gamestate.txt`. The format is a flat, positional, `\r\n`-delimited text file: each
line is one gamestate "slot" (player healths, per-player hand/deck/arsenal/pitch/banish/classState
arrays, the combat chain, decision queue, layers, etc.), with array-valued slots space-joined via
`implode(" ", ...)`. `` `third_party/talishar/WriteGamestate.php` `` builds this line-by-line (over
90 explicit lines covering both players' zones, `$combatChain`, `$decisionQueue`, `$dqVars`,
`$layers`, per-chain-link data appended dynamically by count, and JSON-encoded sub-blobs like
`$p1CardTurnLog`/`$p1LifeHistory` for fields too structured for flat encoding).
`` `third_party/talishar/ParseGamestate.php` `` is the inverse: `ParseGamestate()` (line 27)
`explode("\r\n", ...)` the content and asserts `count($gamestateContent) < 60` as a corruption
guard before unpacking each line back into the same globals.

Reads/writes are cache-fronted for performance: `WriteGamestate.php` calls
`WriteGamestateCache($gameName, $content)` after the file write, and `ParseGamestate.php` reads
via `ReadGamestateCache($gameName)` rather than the file directly on the hot path — backed by APCu
(`` `third_party/talishar/Libraries/CacheLibraries.php` `` lines 3–51: `apcu_fetch`/`apcu_store`
wrap the gamestate read/write, falling back to plain file I/O when the `apcu` extension isn't
loaded). The write path takes an exclusive file lock (`flock($handler, LOCK_EX)`) and logs (not
throws) on lock failure — "action not persisted" — so a lock contention degrades to a dropped
write rather than a crash (`` `third_party/talishar/WriteGamestate.php` ``).

Game creation seeds the initial file: `` `third_party/talishar/MenuFiles/StartHelper.php` ``'s
`initializePlayerState()` writes the starting per-player lines (including the initial all-zero
ClassState line, currently the `fwrite()` at line 45), one `fwrite()` call per slot, matching the
same positional format `WriteGamestate.php`/`ParseGamestate.php` read and write during play.

## DecisionQueue & Await Async Model

A large share of engine logic is driven by the **Decision Queue** (DQ), which queues a sequence of
operations to run as soon as they can, pending user input. `` `third_party/talishar/CardLogic.php` ``
defines the primitives: `AddDecisionQueue($phase, $player, $parameter, $subsequent=0,
$makeCheckpoint=0)` (line 286), `AddLayer($cardID, $player, $parameter, ...)` (line 269), and
`ProcessDecisionQueue()` (line 333), which stashes the current turn phase into `$dqState` and
calls `ContinueDecisionQueue()` to advance. DQs are **asynchronous**: a block of DQ calls followed
by regular PHP code runs the regular code *first* — all queued DQs execute afterward — which is
why any code that must run after a DQ needs to be inside another DQ command, typically by
extending `SPECIFICCARD` (`` `third_party/talishar/New Developer Guide.md` ``, "Decision Queue"
section; also mirrored in `` `third_party/talishar/CLAUDE.md` ``).

Each DQ entry has four fields: the command, the player who may decide, a parameter (static or
dynamic via the special `"<-"` token meaning "the previous `$lastResult`"), and a `subsequent` bit
that skips the entry if a prior DQ in the chain failed/was declined. Common commands documented in
`` `third_party/talishar/New Developer Guide.md` ``: `MULTIZONEINDICES` (wraps `SearchMultizone`,
returns a comma-separated MultiZone Index list), `(MAY)CHOOSEMULTIZONE` (presents a choice from
that list), `SETDQCONTEXT` (sets the decision's helper text), `MZREMOVE` (removes and returns a
card from its zone), `SETLAYERTARGET`, `ELSE` (conditional branch on a prior PASS), `SPECIFICCARD`
(runs regular PHP after a DQ block), `PASSPARAMETER`.

**`Await`** (`` `third_party/talishar/DecisionQueue/AwaitEffects.php` ``) is a wrapper around DQs
meant to remove the pain of tracking `$lastResult` manually. It uses a global associative array,
`$dqVars`, to track named variables instead. Signature:
`Await($player, $function, $returnName="LASTRESULT", $lastResultName="LASTRESULT",
$subsequent=1, $final=false, $prepend=false, ...$args)`. `$function` is a string naming an
`*Await`-suffixed function (by convention in `AwaitEffects.php`) or, if it matches a `cardID`,
routes to that card object's `SpecificLogic()` — this replaces the old `SPECIFICCARD` DQ pattern.
`$final=true` clears `$dqVars` after the last Await in a sequence so future Awaits don't read stale
state. A representative chain, from `` `third_party/talishar/New Developer Guide.md` ``:

```php
Await($this->controller, "DeckTopCards", "cardIDs", number:$numRevealed, subsequent:false);
Await($this->controller, "RevealCards");
Await($this->controller, $this->cardID, mode:"choose_cards");
Await($this->controller, "MultiChooseDeck", "indices");
Await($this->controller, "MultiRemoveDeck", "cardIDs");
Await($this->controller, "MultiAddHand");
Await($this->controller, $this->cardID, mode:"deal_arcane", target:$target);
Await($this->controller, "ShuffleDeck", final:true);
```

For "choose 1 of N" modal effects specifically, the established pattern (confirmed against a real
merged PR — see "Card Recipe" below) combines a `BUTTONINPUT` DQ with `Await(..., final:true)` and
a `TRIGGER` layer so the chosen effect resolves through `ProcessTrigger()` rather than directly
inside `SpecificLogic()`, keeping it correctly ordered on the stack
(`` `third_party/talishar/CLAUDE.md` ``, "Modal Choose-1 Pattern"; `Talishar/Talishar#1370`).

## Layer Stack & CombatChain Resolution

The **layer stack** (`Classes/Stack.php`) is the shared structure everything resolving —
abilities, triggers, attacks — passes through. `` `third_party/talishar/Classes/Stack.php` `` wraps
the flat `$layers` array (the same array `WriteGamestate.php`/`ParseGamestate.php` persist) behind
a `Stack` class: `FindCardUID`, `FindCardSourceUID`, and friends scan `$layers` in fixed-size
strides of `LayerPieces()` elements per entry. Phase markers pushed onto this stack include
`LAYER`, `PRELAYERS`, `TRIGGER`, `PRETRIGGER`, `ABILITY`, `MELD`, `RESUMETURN`, `ATTACKSTEP`, and
`RESOLUTIONSTEP` — `` `third_party/talishar/CombatChain.php` `` lines 2007–2035 define
`IsLayerStep()`, `IsAttackStep()` (`$Stack->FindCardID("ATTACKSTEP")`), `IsResolutionStep()`
(`$Stack->FindCardID("RESOLUTIONSTEP")`), and `AfterDamage()` (true once `RESOLUTIONSTEP` or
`FINALIZECHAINLINK` has been reached) by searching this same stack for those markers.

**CombatChain resolution** (`` `third_party/talishar/CombatChain.php` ``, ~89KB, the single
largest non-generated engine file after `CardLogic.php`/`CardDictionary.php`) computes an attack's
effective power via `LinkBasePower()` (line ~2038): it starts from the card's base `PowerValue()`,
then walks `$currentTurnEffects` and every prior chain link in `$ChainLinks` (a `ChainLinks`
collection — `` `third_party/talishar/Classes/ChainLinks.php` ``) applying layer continuous
buffs/debuffs card-by-card. A card object opts into this system via the base `Card` class hooks
(`` `third_party/talishar/Classes/Card.php` `` lines 106–113): `CombatEffectActive($parameter,
$defendingCard, $flicked)` — returns whether the effect currently applies to the attack on the
chain — and `EffectPowerModifier($param, $attached)` — how much power to add when active. Per the
base class's default (`` `third_party/talishar/Classes/Card.php` ``), a layer continuous effect
disappears once its chain link closes unless `IsCombatEffectPersistent()` is overridden to return
true.

## ClassState Mechanism (the Three-File Dance)

**ClassState** tracks per-turn counters (e.g. "how many auras has this player destroyed this
turn") that card logic checks with simple thresholds. The mechanism spans exactly three files,
confirmed against a real merged PR that added one (`Talishar/Talishar#1370`, "Add
`$CS_NumLightningFlowDestroyed` ClassState variable"):

1. **`` `third_party/talishar/Constants.php` ``** — declares the counter as a sequential global
   index constant (`$CS_NumLightningFlowDestroyed = 116;`, immediately after the previous highest
   index), adds that variable to the `global` declaration list inside `ResetMainClassState()`
   (line ~673), and initializes it to `0` in the same function's body.
2. **`` `third_party/talishar/MenuFiles/StartHelper.php` ``** — `initializePlayerState()` writes
   the game's starting ClassState line (currently the `fwrite()` at line 45, though the exact line
   number shifts as constants are added — find it by grepping the file for `//Class State`) as a
   space-joined string of literal zeros, one per constant; adding a constant means appending one
   more `0` to that literal string so the positional `ParseGamestate.php` unpacking stays aligned.
3. **The trigger call site** — wherever the tracked event actually happens, call
   `IncrementClassState($player, $CS_YourConstant)`. For `Talishar/Talishar#1370` this is
   `` `third_party/talishar/AuraAbilities.php` ``'s `DestroyAura()`, which now increments the
   counter whenever the destroyed aura's `cardID == "lightning_flow"`.

A fourth, read-only step — `GetClassState($player, $CS_YourConstant) > 0` — is how card logic later
*checks* the counter; it doesn't touch new files (`` `third_party/talishar/CardGetters.php `` line
120's `GetPlayerClassState($player)` is the shared accessor both the getter and setter paths route
through, returning the correct one of `$mainClassState`/`$defClassState`/`$myClassState`/
`$theirClassState` depending on whether the "main" gamestate view is currently built). The
higher-level `` `third_party/talishar/Classes/ClassState.php` `` class wraps common named counters
(`NumBoosted()`, `DamageTaken()`, etc.) as convenience getters over the same array — a new counter
doesn't require touching this class unless you want a named accessor rather than calling
`GetClassState()` directly.

## Card Recipe: A Worked Example

New card behavior is implemented as a PHP class in `Classes/CardObjects/{SET}Cards.php`, one file
per set (e.g. `` `third_party/talishar/Classes/CardObjects/OMNCards.php` ``), extending the base
`Card` class (`` `third_party/talishar/Classes/Card.php` ``). `zzCardCodeGenerator.php` at the repo
root auto-populates stats/types/subtypes/pitch/cost/keywords from a FabCube JSON dataset first —
per `` `third_party/talishar/New Developer Guide.md` `` ("Generated Code"), a card simple enough to
be fully auto-generated still gets a class with only `__construct` defined, because deck-loading
checks for an implementing class to flag unreleased-set cards as playable.

**Worked example:** `Talishar/Talishar#1370` ("feat: implement Astral Strike card (OMN145)",
merged, author `brenoos`, approved by `Pgibby8`) implements a Lightning Action Attack whose
resolution ability is a "choose 1 of 3" modal gated on the new
`$CS_NumLightningFlowDestroyed` ClassState counter from the previous section. The PR's diff (`gh
pr diff 1370 --repo Talishar/Talishar`) touches exactly:

- `` `third_party/talishar/Constants.php` `` — adds the `$CS_NumLightningFlowDestroyed = 116`
  constant and its `ResetMainClassState()` wiring.
- `` `third_party/talishar/MenuFiles/StartHelper.php` `` — appends one more `0` to the starting
  ClassState line.
- `` `third_party/talishar/AuraAbilities.php` `` — increments the counter inside `DestroyAura()`
  when the destroyed aura is `lightning_flow`.
- `` `third_party/talishar/Classes/CardObjects/OMNCards.php` `` — the new `astral_strike_red`
  class itself.
- `` `third_party/talishar/CLAUDE.md` `` — the PR also documents the two generalizable patterns it
  introduces (the ClassState tracking recipe and the Modal Choose-1 / BUTTONINPUT+Await+Trigger
  pattern) directly in the repo's own agent-guidance file, which is why both patterns are quoted
  verbatim from that file elsewhere in this document.

The card class shape:

```php
class astral_strike_red extends Card {
  function __construct($controller) {
    $this->cardID = "astral_strike_red";
    $this->controller = $controller;
  }

  function PlayAbility($from, $resourcesPaid, $target = '-', $additionalCosts = '-', $uniqueID = '-1', $layerIndex = -1) {
    global $CS_NumLightningFlowDestroyed;
    if (GetClassState($this->controller, $CS_NumLightningFlowDestroyed) > 0) {
      AddDecisionQueue("SETDQCONTEXT", $this->controller, "Choose a mode for " . CardLink($this->cardID));
      AddDecisionQueue("BUTTONINPUT", $this->controller, "Draw_a_Card,Buff_Power,Go_Again");
      AddDecisionQueue("SHOWMODES", $this->controller, $this->cardID, 1);
      Await($this->controller, $this->cardID, final:true);
    }
    return "";
  }

  function SpecificLogic() {
    global $dqVars;
    AddLayer("TRIGGER", $this->controller, $this->cardID, additionalCosts:$dqVars["LASTRESULT"]);
  }

  function ProcessTrigger($uniqueID, $target = "-", $additionalCosts = "-", $from = "-") {
    switch ($additionalCosts) {
      case "Draw_a_Card": Draw($this->controller); break;
      case "Buff_Power": AddCurrentTurnEffect($this->cardID . "-BUFF", $this->controller); break;
      case "Go_Again": AddCurrentTurnEffect($this->cardID . "-GOAGAIN", $this->controller); break;
    }
  }

  function CombatEffectActive($parameter = '-', $defendingCard = '', $flicked = false) {
    return $parameter == "BUFF" || $parameter == "GOAGAIN";
  }

  function EffectPowerModifier($param, $attached = false) {
    if ($param == "BUFF") return 2;
    return 0;
  }
}
```

(condensed from `Talishar/Talishar#1370`'s actual diff — `astral_strike_red`, ~40 lines, added to
`third_party/talishar/Classes/CardObjects/OMNCards.php`). This demonstrates three recipe patterns
at once: the ClassState-gated modal (`BUTTONINPUT` + `Await(final:true)`), routing the modal
resolution through a `TRIGGER` layer + `ProcessTrigger()` rather than resolving inline in
`SpecificLogic()`, and **suffixed `CurrentTurnEffect` IDs** (`$this->cardID . "-BUFF"`) so one card
can register multiple named layer-continuous effects that `CombatEffectActive`/
`EffectPowerModifier` distinguish by their `$parameter`/`$param` suffix
(`` `third_party/talishar/CLAUDE.md` ``, "CurrentTurnEffect with Suffixed IDs"). A second real
example of the same modal pattern is `Talishar/Talishar#1369` ("feat: implement Voltbound Duality
(OMN077/078/079)"), which additionally demonstrates the `windup` dual-mode archetype (an
instant-or-attack card whose two modes share one class via an `$archetype` object — see
`` `third_party/talishar/New Developer Guide.md` ``'s `$archetype` note and
`` `third_party/talishar/Classes/CardObjects/HVYCards.php` `` for the archetype's home).

Base `Card` class hooks available (`` `third_party/talishar/Classes/Card.php` ``, lines 46–194;
also summarized in `` `third_party/talishar/CLAUDE.md` `` "Card Implementation Pattern"):
`PlayAbility` (resolution ability), `ProcessTrigger`, `IsPlayRestricted`, `PayAdditionalCosts`,
`PayAbilityAdditionalCosts`, `EquipPayAdditionalCosts`, `CombatEffectActive`,
`EffectPowerModifier`, `AbilityPlayableFromCombatChain`, `GoesOnCombatChain`, `NumUses`,
`OnDefenseReactionResolveEffects`, `OnBlockResolveEffects`, `ProcessAbility`,
`CanPlayAsInstant`/`CanActivateAsInstant`, and more — implement only the hooks a given card
actually needs. To route into these from procedural engine code (for cards not yet fully migrated
to the Card-object style), the pattern is `$card = GetClass($card, $player); if ($card != "-")
$card->Method();` (`` `third_party/talishar/CardDictionary.php `` line 4597 defines `GetClass`,
which returns `"-"` when no object exists for the given `cardID`).

## API Surface Overview

`third_party/talishar/APIs/` holds the frontend-facing REST endpoints — 46 files as of this
writing (`ls third_party/talishar/APIs | wc -l`). They follow a shared shape: include
`../HostFiles/Redirector.php` + `../Libraries/HTTPLibraries.php`, call `SetHeaders()` for CORS,
decode `$_POST` from `json_decode(file_get_contents('php://input'), true)` (POST bodies are JSON,
not form-encoded), and return a `stdClass` response JSON-encoded. Representative endpoints:

- `` `third_party/talishar/APIs/CreateGame.php` `` — starts a new game; accepts `deck`/`fabdb`
  (deckbuilder link), `format`, `visibility`, and a `deckTestMode` flag that starts a solo game
  against the AI combat dummy.
- `` `third_party/talishar/APIs/GetInitialGameDataAPI.php` `` — loads
  `../Games/{gameName}/GameFile.txt` if present and includes `APIParseGamefile.php` to hand back
  the initial parsed state.
- `` `third_party/talishar/APIs/JoinGame.php` ``, `SubmitLobbyInput.php`, `ChooseFirstPlayer.php` —
  lobby/setup flow before play begins.
- `` `third_party/talishar/APIs/SubmitSideboard.php` `` — matchup-specific sideboarding between
  games in a set.
- `` `third_party/talishar/APIs/GetReplayTurns.php` ``, `GetSavedReplays.php`, `ShareReplay.php`,
  `SetReplayFavorite.php` — replay retrieval/sharing, separate from live-game state.
- `` `third_party/talishar/APIs/FriendListAPI.php` ``, `BlockedUsersAPI.php`, `UserProfileAPI.php`,
  `ChangeDisplayNameAPI.php` — account/social features, backed by `AccountFiles/` (Metafy/Patreon
  OAuth per `` `third_party/talishar/CLAUDE.md` ``).
- `` `third_party/talishar/APIs/MetafyAPI.php` ``, `CheckPatreonAPI.php`,
  `RefreshMetafyCommunities.php`, `SyncMetafySubscribers.php` — Metafy (formerly Patreon)
  supporter-tier integration, gating cosmetics/features.

Outside `APIs/`, the two highest-traffic endpoints live at the repo root rather than in that
directory: `` `third_party/talishar/ProcessInput.php` `` (all in-game player actions) and
`` `third_party/talishar/GetUpdateSSE.php` `` (state delivery) — see "Engine Request Pipeline" and
"Frontend State Flow" above/below. `` `third_party/talishar/GetNextTurn.php` `` is the
polling-fallback twin of the SSE endpoint.

## Frontend State Flow: SSE → ParseGameState.ts → GameSlice

The FE opens one `EventSource` per active game in
`` `third_party/talishar-fe/src/app/GameStateHandler.tsx` ``, pointed at
`GetUpdateSSE.php?gameName=...&playerID=...&authKey=...`. Three named SSE event types are
consumed: the default `message` event carries the full parsed game state; `typing` and `presence`
carry ephemeral opponent-activity signals (replacing older polling endpoints — see the backend's
own comment in `` `third_party/talishar/GetUpdateSSE.php` ``: "This replaces the old
CheckOpponentTyping polling entirely"); and `hb` is a heartbeat with no payload, sent by the
backend every 15s of otherwise-silent connection
(`` `third_party/talishar/GetUpdateSSE.php` ``'s `if ($currentRealTime - $lastSendTime >= 15)`
block) purely to keep the connection alive and let the FE's watchdog reset its clock.

On `message`, the raw JSON is passed through
`` `third_party/talishar-fe/src/app/ParseGameState.ts` `` (613 lines) — a pure transform from the
backend's wire shape into the FE's `GameState`/`Player`/`Card`/`CombatChainLink` model types
(`` `third_party/talishar-fe/src/features/` ``), coercing loosely-typed fields (numeric strings,
`0`/`1` flags) into real `number`/`boolean` values (e.g. `ParseCard()`'s `card.counters =
input.counters ? Number(input.counters) : 0`). The result is dispatched into Redux via
`receiveGameState` (`` `third_party/talishar-fe/src/features/game/GameSlice.ts `` line 947, the
`receiveGameState` reducer case), which becomes the single source of truth React components
subscribe to.

**Reconnect behavior** (`` `third_party/talishar-fe/src/app/GameStateHandler.tsx `` — verified
directly, not assumed from the PR's Summary text): on `EventSource.onerror`, a retry counter
increments and the connection closes; if this is the very first error before any message has
arrived, it retries once quickly (500ms) as a transient-page-load recovery; otherwise it backs off
exponentially — `Math.min(500 * 2^retryCount, 5000)` ms — up to `MAX_RETRIES = 5`, after which it
falls back to a fixed 10s retry interval and surfaces a "Connection to game server lost.
Reconnecting..." toast once. **Staleness watchdog:** a `setInterval` polling every 10s compares
`Date.now()` against the last-received-event timestamp (`lastEventTimeRef`, updated by every
`message`/`typing`/`presence`/`hb` event) and forces a reconnect if more than **45000ms (45s)** has
elapsed since anything was received — independent of the `onerror` path, so a silently-hung
connection (no `error` event fired) is still caught.

## Card-Image Pipeline

Card art flows through `third_party/talishar-cardimages` (upstream `Talishar/CardImages`) before
either engine or FE ever touches it. `` `third_party/talishar-cardimages/scripts/downloadImages.js` ``
fetches per-language card metadata from the official `cards.fabtcg.com` search API
(`composeInitialApiUrl`), downloads each card's official image, and — via
`` `third_party/talishar-cardimages/scripts/utils/sharpHelper.js` `` (`saveCardImage`,
`resizeImage`) — writes both a full-size copy and a square-cropped copy, sorted under
`media/{uploaded/public|missing}/{cardimages|cardsquares}/{language}/` (constants `CARD_IMAGES`,
`CARD_SQUARES` in that same script). `` `third_party/talishar-cardimages/scripts/generateTranslatedCollections.js` ``
handles reprint sets (e.g. new History Packs): it produces a JSON mapping from an original card ID
to the reprint's collection ID, consumed by the FE for multi-language display.

On the FE side, `` `third_party/talishar-fe/package.json` ``'s `generate-cards` script
(`node scripts/card-generator.js && npx prettier --write src/constants/cardList.ts`) regenerates
`src/constants/cardList.ts` — the authoritative list of playable card *names* — by fetching
`https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/main/json/english/card.json`
directly (`` `third_party/talishar-fe/scripts/card-generator.js` ``), the same the-fab-cube dataset
`zzCardCodeGenerator.php` consumes on the backend (§8.1 of the spec) — this keeps the FE's
autocomplete/search card list and the backend's generated stats derived from one shared upstream
source. A sibling `generate-keywords` script similarly regenerates keyword/CR-text data.

**CDN naming:** the FE serves card art from a CDN base of
`https://images.talishar.net/public` (`` `third_party/talishar-fe/src/appConstants.ts `` line 5,
`CLOUD_IMAGES_URL`), with the same `cardimages`/`cardsquares` + language + filename layout
`downloadImages.js` writes locally — the local `media/` tree and the CDN mirror the same relative
path structure.

## Local Dev Stack

Backend: `bash start.sh` at `` `third_party/talishar/start.sh` `` — copies
`HostFiles/RedirectorTemplate.php` to `HostFiles/Redirector.php` (a required, not-checked-in
per-install config file), seeds `HostFiles/GameIDCounter.txt`, creates a writable `Games/`
directory, then runs `docker compose up -d`. The compose file
(`` `third_party/talishar/docker-compose.yml` ``) defines four services:

- `web-server` — Apache/PHP on host port **8080** (`ports: ["8080:80"]`), mounting the current
  directory plus sibling `../Talishar-FE` (for ad-hoc `zzCardCodeGenerator.php` runs) and Xdebug/
  OPCache/APCu-tuning/Apache-performance config files as read-only overlays.
- `mysql-server` — MySQL, database `fabonline`, initialized from `` `third_party/talishar/Database/` ``.
- `phpmyadmin` — on host port `5001`.
- `redis` — on host port `6382` (container-internal `6379`), named `app_redis`.

Frontend: `npm run dev` (Vite) in `third_party/talishar-fe`, default port `5173` (Vite's own
default — the repo's `` `third_party/talishar-fe/vite.config.mts` `` doesn't override `server.port`).
That same config's `server.proxy` block forwards `/api`, `/APIs`, and `/AccountFiles` requests to
`` `http://${VITE_BACKEND_URL:-localhost}:${VITE_BACKEND_PORT:-8080}/${VITE_BACKEND_DIRECTORY:-game}` ``
— i.e. it defaults to the same **8080** the backend's own compose file publishes, confirming the
two repos agree on the port without either hardcoding a shared constant.

Xdebug listens on port `9003` inside the container; `` `third_party/talishar/CLAUDE.md` ``'s
"Ports" line and `` `third_party/talishar/README.md` `` both document the full debugger setup
(PHPStorm and VS Code `launch.json` configs, `idekey` filtering) — see "Known Stale Upstream Docs"
below for the one place these two docs' port claims used to diverge and no longer do.

Sibling-directory layout is load-bearing, not cosmetic: `docker-compose.yml`'s `web-server.volumes`
mounts `../Talishar-FE` into the container, and the card-image pipeline scripts assume `CardImages`
is a sibling of `Talishar` too (`` `third_party/talishar/README.md` ``: "It's important... to have
Talishar-FE and CardImages repositories located in the same directory as Talishar"). fab-cli's own
vendoring under `third_party/{talishar,talishar-fe,talishar-cardimages}` preserves this sibling
relationship (see `scripts/talishar-bootstrap.sh` and `CLAUDE.md`'s "Vendoring layout").

## Upstream Contribution Conventions

Two real merged PRs anchor the observed convention: `Talishar/Talishar#1370` ("feat: implement
Astral Strike card (OMN145)") and `Talishar/Talishar#1369` ("feat: implement Voltbound Duality
(OMN077/078/079)"), both authored by `brenoos` and reviewed/approved by `Pgibby8`, both with a
`## Summary` section listing the card's rules text and implementation notes in bullet form. Not
every merged PR follows a strict `feat:`/`fix:` prefix in practice — a sample of the ten most
recently merged PRs at research time (`gh pr list --repo Talishar/Talishar --state merged --limit
10`) includes titles like "Fix Spitfire's +1 cog prompt being skipped after declining a wager" and
"Standardize Cog tap/untap handling across Mechanologist cards" alongside strictly-prefixed ones —
so `feat:`/`fix:` is a strong convention for card-implementation PRs specifically (matching
`Talishar/Talishar#1370`/`#1369`), not an enforced repo-wide rule. `` `third_party/talishar/README.md` ``
directs contributors and bug reporters to the project Discord for coordination; there is no
`CONTRIBUTING.md` and no PR template
(`` `third_party/talishar/.github/` `` contains only `FUNDING.yml` and `dependabot.yml`) — process
conventions live in the community/Discord and in `` `third_party/talishar/CLAUDE.md `` /
`` `third_party/talishar/New Developer Guide.md` `` rather than a formal contributing doc.

Per fab-cli's own hard invariant (§10 I1 of `SPEC-TALISHAR.md`, mirrored in `CLAUDE.md`): tooling
built on this vendoring only ever pushes branches to the user's fork
(`git@github.com:Zugruul/<repo>.git`) and prepares PR title/body text — it never opens, marks
ready, approves, or merges a PR against a `Talishar/*` org repo. Every upstream PR in this
document's citations (`#1370`, `#1369`) was inspected read-only via `gh pr view`/`gh pr diff`,
never acted on.

## Known Stale Upstream Docs

- **`third_party/talishar-cardimages/README.md`'s clone URL is wrong.** Its "Requirements / How to
  install" section says `git clone https://github.com/Talishar/Card-Images` (hyphenated,
  capital-C "Images"), but the actual repository — confirmed via
  `git -C third_party/talishar-cardimages remote -v` — is `Talishar/CardImages` (no hyphen). The
  hyphenated URL 404s. Trust the vendoring layout in fab-cli's own `CLAUDE.md`
  (`third_party/talishar-cardimages/`) and the bootstrap script's `Zugruul/CardImages`/
  `Talishar/CardImages` remote pair over this README.
- **The backend README-vs-port claim SPEC-TALISHAR.md flagged (8000 vs 8080) is no longer
  reproducible against the current vendored clone.** As of this research pass,
  `` `third_party/talishar/README.md` `` contains no port number at all (it defers to Docker/
  Google-Docs links), and `` `third_party/talishar/CLAUDE.md` `` already states the correct
  **8080** (`"Ports: Web: 8080, PhpMyAdmin: 5001, Redis: 6382, Xdebug: 9003"`), matching
  `` `third_party/talishar/docker-compose.yml` ``'s `ports: ["8080:80"]` and
  `` `third_party/talishar-fe/vite.config.mts` ``'s `devPort` default of `'8080'`. The original
  8000-vs-8080 discrepancy (SPEC-TALISHAR.md §5, verified 2026-07-18 against merged PRs #1370/
  #1369) appears to have been corrected upstream since that verification — recorded here so a
  future reader doesn't go looking for a stale README claim that no longer exists in the clone.
  If a future refresh finds the README diverging from `docker-compose.yml`/`.env` again, trust the
  compose file and `CLAUDE.md`, not the prose README.
