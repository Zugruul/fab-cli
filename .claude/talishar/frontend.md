# Talishar Frontend — SSE State Flow

Last verified against upstream: 2026-07-18

Working reference for the Vite+React SPA's state pipeline
(`third_party/talishar-fe`, upstream `Talishar/Talishar-FE`).

## SSE connection

The FE opens one `EventSource` per active game in
`` `third_party/talishar-fe/src/app/GameStateHandler.tsx` ``, pointed at
`GetUpdateSSE.php?gameName=...&playerID=...&authKey=...` (backend endpoint:
`` `third_party/talishar/GetUpdateSSE.php` ``).

Three named SSE event types:

- **`message`** (default) — carries the full parsed game state.
- **`typing`** / **`presence`** — ephemeral opponent-activity signals, replacing older polling
  endpoints (`` `third_party/talishar/GetUpdateSSE.php` ``'s own comment: "This replaces the old
  CheckOpponentTyping polling entirely").
- **`hb`** — heartbeat, no payload, sent every 15s of otherwise-silent connection
  (`` `third_party/talishar/GetUpdateSSE.php` ``'s `if ($currentRealTime - $lastSendTime >= 15)`
  block) purely to keep the connection alive and reset the FE watchdog's clock.

## Parse pipeline: ParseGameState.ts → GameSlice

On `message`, the raw JSON passes through
`` `third_party/talishar-fe/src/app/ParseGameState.ts` `` (613 lines) — a pure transform from the
backend's wire shape into the FE's `GameState`/`Player`/`Card`/`CombatChainLink` model types
(`` `third_party/talishar-fe/src/features/` ``), coercing loosely-typed fields (numeric strings,
`0`/`1` flags) into real `number`/`boolean` values (e.g. `ParseCard()`'s `card.counters =
input.counters ? Number(input.counters) : 0`).

The result dispatches into Redux via `receiveGameState`
(`` `third_party/talishar-fe/src/features/game/GameSlice.ts `` line 947, the `receiveGameState`
reducer case) — the single source of truth React components subscribe to.

## Reconnect behavior

Verified directly against `` `third_party/talishar-fe/src/app/GameStateHandler.tsx` `` (not
assumed from PR summary text). On `EventSource.onerror`:

- A retry counter increments and the connection closes.
- If this is the very first error before any message has arrived, retries once quickly (500ms) —
  transient-page-load recovery.
- Otherwise, exponential backoff: `Math.min(500 * 2^retryCount, 5000)` ms, up to `MAX_RETRIES = 5`.
- After `MAX_RETRIES` is exceeded, falls back to a fixed 10s retry interval and surfaces a
  "Connection to game server lost. Reconnecting..." toast once.

## Staleness watchdog

A `setInterval` polling every 10s compares `Date.now()` against the last-received-event timestamp
(`lastEventTimeRef`, updated by every `message`/`typing`/`presence`/`hb` event) and forces a
reconnect if more than **45000ms (45s)** has elapsed since anything was received — independent of
the `onerror` path, so a silently-hung connection (no `error` event fired) is still caught.

## Card list & keyword generation

`` `third_party/talishar-fe/package.json` ``'s `generate-cards` script (`node
scripts/card-generator.js && npx prettier --write src/constants/cardList.ts`) regenerates
`src/constants/cardList.ts` — the authoritative list of playable card *names* — by fetching
`https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/main/json/english/card.json`
directly (`` `third_party/talishar-fe/scripts/card-generator.js` ``), the same the-fab-cube dataset
`zzCardCodeGenerator.php` consumes on the backend (see `card-recipe.md` §1). A sibling
`generate-keywords` script regenerates keyword/CR-text data similarly. Run this after adding a new
card so autocomplete/search picks it up.

## CDN / card art

The FE serves card art from a CDN base of `https://images.talishar.net/public`
(`` `third_party/talishar-fe/src/appConstants.ts `` line 5, `CLOUD_IMAGES_URL`), mirroring the same
`cardimages`/`cardsquares` + language + filename layout the CardImages pipeline scripts write
locally (see `dev-stack.md`'s "Card-image pipeline" note).

## Dev server & proxy

`npm run dev` (Vite) in `third_party/talishar-fe`, default port `5173` (Vite's own default —
`` `third_party/talishar-fe/vite.config.mts` `` doesn't override `server.port`). That config's
`server.proxy` block forwards `/api`, `/APIs`, `/AccountFiles` to
`` `http://${VITE_BACKEND_URL:-localhost}:${VITE_BACKEND_PORT:-8080}/${VITE_BACKEND_DIRECTORY:-game}` ``
— defaulting to the backend's own compose port **8080** (see `dev-stack.md`), confirming the two
repos agree on the port without a shared hardcoded constant.

## Curated reference set

Sibling files: `architecture.md` (engine pipeline overview), `card-recipe.md` (card implementation
recipe), `decision-queue.md` (DQ/Await reference), `dev-stack.md` (local dev stack), `contributing.md`
(fork/PR conventions). Long-form narrative: `docs/TALISHAR-ARCHITECTURE.md`'s "Frontend State Flow"
section.
