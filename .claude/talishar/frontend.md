# Talishar Frontend — SSE State Flow

Last verified against upstream: 2026-07-18

Working reference for the Vite+React SPA's state pipeline
(`third_party/talishar-fe`, upstream `Talishar/Talishar-FE`).

## SSE connection

Each active game gets its own `EventSource`, opened in
`` `third_party/talishar-fe/src/app/GameStateHandler.tsx` `` against
`GetUpdateSSE.php?gameName=...&playerID=...&authKey=...` (backend endpoint:
`` `third_party/talishar/GetUpdateSSE.php` ``).

The backend multiplexes three event names over that one stream:

- **`message`** (the SSE default) — the full parsed game state.
- **`typing`** / **`presence`** — lightweight opponent-activity signals that replaced older
  polling endpoints (per the backend file's own comment: "This replaces the old CheckOpponentTyping
  polling entirely").
- **`hb`** — a payload-less heartbeat fired whenever 15s pass with nothing else to send
  (`if ($currentRealTime - $lastSendTime >= 15)` in `` `third_party/talishar/GetUpdateSSE.php` ``);
  its only job is keeping the connection alive and resetting the FE watchdog's clock (see below).

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

Read directly out of `` `third_party/talishar-fe/src/app/GameStateHandler.tsx` `` (not inferred
from a PR description). `EventSource.onerror` closes the connection and bumps a retry counter,
then branches:

- First-ever error, before any message has arrived: one quick 500ms retry (covers a slow initial
  page load, not a real outage).
- Any later error: exponential backoff, `Math.min(500 * 2^retryCount, 5000)` ms.
- Past `MAX_RETRIES = 5`: gives up on backoff, switches to a flat 10s retry cadence, and shows a
  one-time "Connection to game server lost. Reconnecting..." toast.

## Staleness watchdog

`onerror` isn't the only trigger — a `setInterval` fires every 10s and diffs `Date.now()` against
`lastEventTimeRef`, a timestamp bumped by every `message`/`typing`/`presence`/`hb` event. Once that
gap exceeds **45000ms (45s)**, it forces a reconnect on its own, which is what catches a connection
that has gone silently dead without ever firing `error`.

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
