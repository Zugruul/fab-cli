---
tags: [talishar, architecture, frontend, sse, redux]
paths: []
strength: 1
source: "third_party/talishar-fe/src/app/GameStateHandler.tsx; third_party/talishar-fe/src/app/ParseGameState.ts; third_party/talishar-fe/src/features/game/GameSlice.ts; third_party/talishar-fe/src/features/GameState.ts; third_party/talishar-fe/src/features/Player.ts"
graduated: false
created: 2026-07-18
---

The FE opens one `EventSource` per active game in
`third_party/talishar-fe/src/app/GameStateHandler.tsx`, pointed at
`GetUpdateSSE.php?gameName=...&playerID=...&authKey=...`. Three named SSE event types: the default
`message` event carries the full parsed game state; `typing`/`presence` carry ephemeral
opponent-activity signals (replacing older polling endpoints, see [[tal-arch-api-surface]]'s
`CheckOpponentTyping.php` entry); `hb` is a payload-less heartbeat sent every 15s of otherwise-silent
connection, purely to keep the connection alive and reset the FE watchdog's clock.

On `message`, the raw JSON passes through `third_party/talishar-fe/src/app/ParseGameState.ts` (613
lines) — a pure transform from the backend's wire shape into the FE's `GameState`/`Player`/`Card`/
`CombatChainLink` model types, coercing loosely-typed fields (numeric strings, `0`/`1` flags) into
real `number`/`boolean` (e.g. `ParseCard()`'s `card.counters = input.counters ?
Number(input.counters) : 0`). The result dispatches into Redux via the `receiveGameState` reducer
case (`third_party/talishar-fe/src/features/game/GameSlice.ts` line 947), which merges into state
via `mergeReceivedGameState()` (same file, line 291) — a hand-written merge (not a blind overwrite).
For `playerOne`/`playerTwo` as a whole it's a shallow spread with the *incoming* payload winning
(`{...prevGame.playerOne, ...payload.playerOne}`, lines 306-307) — i.e. the previous value is only
a fallback for fields the payload omits. But five specific player-identity fields get the opposite,
**partial-authority** treatment layered on top (lines 309-318): `Name`, `isPatron`,
`isContributor`, `isPvtVoidPatron`, `metafyTiers` are force-reset back to the *previous* Redux
value whenever that previous value was not `undefined` — so for these five fields specifically, the
previous client-held value wins over a fresh incoming one, and only an `undefined` previous value
lets the incoming payload's value through. `mergeReceivedGameState()` also calls
`preserveIdentities()` on nested objects/arrays (`playerOne`, `playerTwo`, `activeChainLink`,
`activeLayers`, `oldCombatChain`) — likely to keep referential stability for React's diffing rather
than force a full re-render on every SSE tick.

**FE data model shape** (`third_party/talishar-fe/src/features/GameState.ts`): the top-level
`GameState` interface is large and UI-heavy — alongside `playerOne`/`playerTwo: Player`,
`gameInfo: GameStaticInfo`, `gameDynamicInfo: GameDynamicInfo`, and `activeChainLink`/
`oldCombatChain: CombatChainLink[]`, it also carries dozens of pure-UI fields not present in the
backend wire format at all: `popup`, `playCardMessage`, `cardListFocus`, `activeLayers`,
`playerInputPopUp` (buttons/prompt text for the current decision), `damagePopups`/
`healingPopups`/`actionPointPopups` (per-player animation queues), `chainLinkSummary`,
`spectatorCameraView`. `Player` (`third_party/talishar-fe/src/features/Player.ts`) mirrors the
backend's zone model directly: `Hand`/`Arsenal`/`Banish`/`Graveyard`/`Pitch`/`Deck`/`Soul: Card[]`
plus equipment slots (`HeadEq`/`ChestEq`/`ArmsEq`/`LegsEq`/`WeaponLEq`/`WeaponREq`/`Hero: Card`) and
scalar counts (`Health`, `ActionPoints`, `DeckSize`, `PitchRemaining`, `BanishCount`,
`GraveyardCount`, `SoulCount`).

**Reconnect behavior** (read directly from `GameStateHandler.tsx`, not inferred from a PR summary):
`EventSource.onerror` closes the connection and bumps a retry counter. The very first error before
any message has arrived gets one quick 500ms retry (covers slow initial page load, not a real
outage); any later error backs off exponentially, `Math.min(500 * 2^retryCount, 5000)`ms, up to
`MAX_RETRIES = 5`, after which it falls back to a flat 10s retry cadence and shows a one-time
"Connection to game server lost. Reconnecting..." toast.

**Staleness watchdog**, independent of `onerror`: a `setInterval` every 10s compares `Date.now()`
against `lastEventTimeRef` (bumped by every `message`/`typing`/`presence`/`hb` event) and forces a
reconnect once the gap exceeds **45000ms (45s)** — catching a connection that silently hung without
ever firing `error`.

See [[tal-arch-request-pipeline]] for the backend side of this same delivery path.
