# Design — fab/E4: Live follow CLI

Grounded in: SPEC §5, §9.1–§9.4, §10 I4, I5.

## Components

- `src/fabtcg.ts` gains `followPlayerPath(slug, playerName, opts): AsyncIterable<LiveFollowEvent>` (or an equivalent callback-based `runLiveFollow(...)` — dev agent's call on the exact shape, see Interfaces below for the required semantics) — the core polling state machine. No new command: `fabtcg coverage <event> --path <name> --live [--interval <seconds>]` is the entry point, extending the EXISTING `--path` handling in `src/commands/fabtcg.ts`'s `coverage` action (read it — it already resolves `opts.path`/`opts.searchPlayer` and calls `fetchPlayerPath`).
- `src/commands/fabtcg.ts`'s `coverage` command gains two new options: `--live` (boolean) and `--interval <seconds>` (default `60`). Only meaningful in combination with `--path`/`--search-player` resolving to exactly one player — reuse the EXISTING `searchPlayerInEvent` ambiguity-resolution pattern already used for `--search-player`'s multi-match case (see Interfaces).
- Reuses, unchanged: `fetchCoverageIndex` (has `hasFinalStandings: boolean` — the exact signal §9.3 needs), `fetchRoundPairings`, `searchPlayerInEvent`, `printPlayerPath` (for the initial non-live summary render — `--live` still prints the existing static summary once at start, per §9.1 "extends the EXISTING command", then begins appending live update lines).
- Reuses `cachedFetch` (`src/http.ts`, already exists) for the caching layer §9.4 requires — see Interfaces for exactly which fetches get cache-wrapped and why.

## Data model

```ts
export interface LiveFollowOptions {
  intervalMs?: number;      // default 60_000
  onUpdate: (line: string) => void;   // one line per new round result/standing change
  onFinal: (summary: string) => void; // called once, when hasFinalStandings flips true
  signal: AbortSignal;                // caller-owned; aborting stops the loop cleanly
}

export interface LiveFollowResult {
  reason: "final-standings" | "aborted";
}

export async function runLiveFollow(
  slug: string,
  playerName: string,
  opts: LiveFollowOptions,
): Promise<LiveFollowResult>;
```
Callback-based rather than an async generator: simpler to unit-test with fake timers (drive `onUpdate`/`onFinal` call assertions directly) and simpler for the CLI action to wire into `console.log` + a real `SIGINT` listener without generator/`for await` ceremony. If the dev agent finds an async-generator shape cleaner to implement AND equally testable with fake timers, that's an acceptable deviation — the callback contract above is the MINIMUM required surface, not a rigid mandate on iteration style.

## Interfaces / contracts

- **Ambiguity check before starting the loop (§9.3's "ambiguous player → candidates list, exit")**: `--live --path <name>` must resolve `<name>` via `searchPlayerInEvent(slug, name)` FIRST. Zero matches → existing "No players found" message, exit 1 (matches `--search-player`'s existing zero-match UX). Exactly one match → proceed to the live loop using that resolved exact name. Two-or-more matches → print the candidates list (same format `--search-player`'s multi-match branch already uses) and exit 1, WITHOUT starting the loop. This is a NEW check specifically for `--live` — today's plain (non-live) `--path <name>` silently picks the first substring match found in `fetchPlayerPath`'s internal resolution loop (read it — `outer: for (const roundPairings of allPairings) { if (p.player1.toLowerCase().includes(lowerName)) {...break outer} }`); `--live` must NOT inherit that silent-first-match behavior, it must actively disambiguate before committing to a long-running poll.
- **Initial summary (§9.1)**: on `--live` start (after ambiguity resolution), call the existing `fetchPlayerPath` + `printPlayerPath` ONCE to print the standard static summary — this is what "extends the EXISTING command" means; `--live` is additive on top, not a replacement render path.
- **Polling loop mechanics (§9.2, §9.3)**:
  1. Track `seenRounds: Set<number>` (result rounds already reported) and `hasEnded: boolean`, seeded from the initial `fetchPlayerPath` call's own round data (so the loop's FIRST live-mode network activity happens at the first poll tick, `intervalMs` after start — the initial summary print doesn't itself count as poll tick #1, per §9.2's "each new round result... printed once" implying rounds already shown in the initial summary are not re-announced as "new").
  2. Each tick: fetch `fetchCoverageIndex(slug)` wrapped in `cachedFetch(\`live-index:${slug}\`, () => fetchCoverageIndex(slug), { ttlMs: opts.intervalMs })` — the disk-cache wrapper is what makes "unchanged poll causes no re-parse (cache hit tested)" a testable, verifiable contract: a test can call the tick logic twice within the same TTL window and assert the SECOND call is a genuine cache hit (no new `httpFetch`/network call observed via the mock), proving the caching claim rather than merely asserting "no visible output changed."
  3. Diff `idx.resultRounds` against `seenRounds`: for each round number present in `idx.resultRounds` but NOT in `seenRounds`, fetch that round's pairings (`fetchRoundPairings(slug, round)`, plain `httpFetch` — NOT `cachedFetch`, since a round appearing for the first time is by definition new data, wrapping it in a cache would just add pointless indirection for a call that only ever happens once per round number) and extract this player's result (win/loss/draw/bye vs. opponent+hero, matching the fields `PlayerRoundResult`/`RoundPairing` already carry). Add the round to `seenRounds`, call `opts.onUpdate(...)` with a timestamped line (`[HH:MM:SS] Round N: <result> vs <opponent> (<hero>)`). A tick where `idx.resultRounds` has no new entries beyond `seenRounds` calls `onUpdate` ZERO times (§9.2's "unchanged poll... prints nothing").
  4. If `idx.hasFinalStandings` is true and it wasn't true on the previous tick (or simply: it's true and `hasEnded` is still false), fetch the player's final standing/result (reuse whatever the codebase's existing `--round final` standings-fetch mechanism is — read the `coverage --round final` action for the pattern), call `opts.onFinal(...)` once with the summary line, set `hasEnded = true`, and return `{ reason: "final-standings" }` — the loop function itself resolves/returns here, ending the polling (§9.3's "exits cleanly on final standings").
  5. Between ticks, `await` a cancellable delay (`setTimeout` wrapped so `opts.signal`'s abort immediately resolves/short-circuits the wait rather than blocking until the full interval elapses) — this is what makes Ctrl-C exit promptly rather than up to `intervalMs` late.
- **SIGINT (§9.3's "clean Ctrl-C")**: the CLI action (`src/commands/fabtcg.ts`) owns a real `AbortController`, registers `process.on("SIGINT", () => controller.abort())` ONLY while the live loop is active (removed/no-op again once the loop ends, so a later unrelated Ctrl-C during a different command isn't silently swallowed by a stale listener), passes `controller.signal` into `runLiveFollow`. On `{reason: "aborted"}`, print a short "stopped" line and exit 0 (Ctrl-C is a normal, clean termination for a `--live` watch command, not an error).
- **Testability (non-negotiable for a real-time polling feature)**: use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(...)` (vitest's fake-timer API) to drive the loop through several simulated ticks in a test without real wall-clock delay. Do NOT write a test that `await`s real `setTimeout`/`setInterval` for anywhere close to a real 60s interval — use a short `intervalMs` (e.g. 100) in tests with fake timers advanced programmatically, or fake timers advanced by the REAL default 60_000 value (fake timers make this instantaneous either way — prefer testing with the REAL default 60_000 via fake-timer advancement, so the test also proves the default itself, not just an artificially-shortened stand-in).
- **I5 (fabtcg.com ≤5 concurrent, browser headers, backoff)**: the polling loop's per-tick fetches must go through the EXISTING `httpFetch`/`cachedFetch` machinery unchanged (already enforces headers/backoff) — do not add a second, parallel fetch mechanism for live mode.
- **I4 (network-free gate)**: all polling-loop tests mock every HTTP call via the existing `test/helpers/http-mock.ts` pattern (direct precedent: `test/rules.test.ts`/`test/rules-search.test.ts`'s `installHttpMock`/`mockPool`) — no real network, no real multi-second wait, ever, in the gate.

## Decisions

- **Callback-based `runLiveFollow`, not a new top-level command** — §9.1 is explicit the feature extends `coverage --path`, not a new command; a callback contract keeps the CLI action's `console.log`/SIGINT-wiring simple and keeps the core polling logic in `fabtcg.ts` cleanly unit-testable independent of any I/O concerns.
- **`cachedFetch` wraps ONLY the coverage-index fetch, not round-pairings fetches** — the index is what's checked EVERY tick regardless of whether anything changed (so TTL-based cache-hit avoidance genuinely matters there); a round's pairings are fetched AT MOST ONCE per round number for the whole session (the moment a round first appears in `resultRounds`), so wrapping that one-shot fetch in a cache adds no value and would only obscure the one-fetch-per-round contract with irrelevant TTL semantics.
- **A new, dedicated ambiguity check for `--live`, not reuse of `fetchPlayerPath`'s silent-first-match** — a long-running poll silently watching the WRONG player (because their name substring-matched someone else first) is a much worse failure mode than a one-shot `--path` lookup picking a slightly-wrong match; §9.3's explicit "ambiguous player → candidates list, exit" AC exists specifically to prevent this for the live case.
- **SIGINT listener scoped to the loop's lifetime, not global** — prevents a stale handler from swallowing a LATER, unrelated Ctrl-C after the live session naturally ends via final standings.

## Out of scope for this epic (E4)

- Any change to the non-`--live` `coverage --path` rendering (`printPlayerPath`) — unchanged, still the exact same static summary.
- Dual-format event handling gets NO special-case code — the AC's "works on dual-format events (fixtures)" is satisfied by the SAME round-diffing logic already being format-agnostic (a round's pairing extraction doesn't care which format that round happened to be); the AC requirement is a TEST obligation (a dual-format fixture must be exercised), not new dual-format-aware production code.
