# Design — fab/E2: Knowledge bases (rules + cards)

Grounded in: SPEC §5, §7.1, §7.2, §7.2b, §10 I1, I2, I3, I8.

## Components

- `src/rules.ts` (new) — rules KB builder, following the `src/lore.ts` pattern (frontmatter markdown chunks + rebuildable JSON index, index git-ignored):
  - `syncRules()` — orchestrates all four sources below, writes chunks under `kb/rules/<document>/<section-slug>.md`, then rebuilds `kb/rules/index.json`. Supersession: for each document, delete any existing chunk files under `kb/rules/<document>/` before writing the freshly chunked set, so a re-sync never leaves stale chunks from a previous version's section layout.
  - Source 1/2/3 — CR, TRP, PPG: read the already-vendored `third_party/fab-rules/en-fab-{cr,trp,ppg}.txt` (kept fresh by the existing `rules update-docs` command / `src/rulesDocs.ts` — FAB-020 calls `updateRulesDocs()` itself at the start of `syncRules()` rather than duplicating fetch/validate logic). Chunk each by the document's own numbered-section headings (regex over the txt's existing section-number lines, e.g. `^\d+(\.\d+)*\s`).
  - Source 4 — Casual Procedure Guide: `docs/references/FaB_Casual_Procedure_Guide_2023-10-13.pdf`, converted to text via a new light dependency (`pdf-parse` — pure-JS, no native build step, keeps I6 intact) and chunked by its heading structure; frontmatter cites the vendored PDF as provenance per §7.2 (no live URL — it's a static vendored artifact).
  - Source 5 — Card Legality Policy: fetched live from `https://fabtcg.com/rules-and-policy-center/card-legality-policy/` (HTML→text, main content only) EVERY sync call, never cached to disk between syncs (§10 I2) — still written as a `kb/rules/` chunk file (readable offline afterward) but the fetch itself is never skipped/TTL'd.
  - `RulesChunk` interface: `{ document: "CR"|"TRP"|"PPG"|"CPG"|"legality", section: string, title: string, sourceUrl: string, version: string, fetchedAt: string, text: string }`. `version` = each doc's own version marker: CR/TRP/PPG use the `last-modified` value already captured in `third_party/fab-rules/VERSIONS.txt`; CPG uses the PDF filename's date (`2023-10-13`, static); legality has no stable version, so `version: "live"`.
  - `kb/rules/index.json` mirrors `lore/index.json`'s shape (`LoreIndex`-equivalent): `{ builtAt, count, chunks: RulesChunk[] }`.
- `src/commands/rules.ts` — add a `rules sync` subcommand next to the existing `update-docs` (kept as-is; `sync` is layered on top, not a replacement — a user who only wants the raw vendored `.txt` refresh still has `update-docs`). `sync` calls `syncRules()`, prints a per-source summary (chunk count, updated/unchanged), matching `update-docs`'s existing per-file line style.
- No search/ask/show command in this task — FAB-021/FAB-022/FAB-024 build on top of `kb/rules/index.json`; FAB-020's contract with them is the index file's shape above.

## Data models

```ts
interface RulesChunk {
  document: "CR" | "TRP" | "PPG" | "CPG" | "legality";
  section: string;    // e.g. "3.1.2" for CR/TRP/PPG, heading text for CPG, "current" for legality
  title: string;       // section heading text
  sourceUrl: string;   // rules.fabtcg.com/... ; fabtcg.com/... for legality; local vendored path note for CPG
  version: string;     // last-modified (CR/TRP/PPG), PDF date (CPG), "live" (legality)
  fetchedAt: string;   // ISO timestamp of this sync
  text: string;        // chunk body, plaintext
}
interface RulesIndex {
  builtAt: string;
  count: number;
  chunks: RulesChunk[];
}
```

## Interfaces / contracts

- `syncRules(): Promise<{ document: string; chunks: number; status: "ok" | "failed"; detail?: string }[]>` — one result row per source (CR, TRP, PPG, CPG, legality), independent failure isolation: a failed legality fetch (network down) must not block CR/TRP/PPG/CPG chunks from being written, and vice versa (mirrors `updateRulesDocs()`'s per-doc isolation).
- Every chunk file is markdown with YAML frontmatter (`document`, `section`, `title`, `source_url`, `version`, `fetched_at`) followed by the chunk text — same shape as `lore/**.md`, so a future `rules search`/`show` (FAB-021) can reuse the lore-reader pattern.
- `kb/rules/` (chunk files + `index.json`) is entirely git-ignored — rebuildable via `rules sync`, never committed. Note this is a stricter ignore than `lore/`'s: `lore/` commits its OKF `.md` files and only ignores the derived `index.json`/`.sync-state.json`; here nothing under `kb/rules/` is committed, since the rules chunks are themselves fully rebuildable from vendored/live sources with no manual curation layer to preserve.
- Legality re-fetch-always is enforced structurally: `syncRules()` has no TTL/staleness check on the legality source — it fetches unconditionally on every call. This is the mechanism §10 I2 requires; FAB-021 must not add caching on top for legality queries.

## Key sequences

1. `fab-cli rules sync` → `registerRules` → `syncRules()`:
   a. `updateRulesDocs()` (existing, unchanged) refreshes `third_party/fab-rules/*.txt`, validated + versioned.
   b. Chunk CR/TRP/PPG from the vendored txt files by section-number headings; write `kb/rules/{cr,trp,ppg}/<section-slug>.md`.
   c. Extract CPG PDF text (`pdf-parse`); chunk by heading structure; write `kb/rules/cpg/<section-slug>.md`.
   d. Fetch the legality policy page live, HTML→text; write `kb/rules/legality/current.md` (single chunk — the page isn't naturally sectioned).
   e. Rebuild `kb/rules/index.json` from all chunk files currently on disk (so supersession — stale chunks from a previous section layout — is enforced by (a) deleting each document's chunk dir before rewriting it, not by additive index merging).
   f. Print per-source summary lines; non-zero exit if any source failed AND its chunk set ends up empty (a source that failed but still has a prior chunk set on disk from an earlier successful sync is a soft warning, not a hard failure — offline resilience matches `lore search`'s tolerance).
2. Tests mock all network (CR/TRP/PPG via the existing `rulesDocs.ts` mock pattern already in `test/`, legality page via a fixture HTML file) and use a small fixture CPG PDF (or a fixture pre-extracted text file if a real minimal PDF fixture is impractical to construct — dev agent's call, document the choice) — never hit live `rules.fabtcg.com`/`fabtcg.com` in the gate (I4).

## Decisions

- **Reuse `updateRulesDocs()` rather than re-fetching CR/TRP/PPG independently** — avoids duplicating the validated-download logic (size/sentinel/HTML-error guards) that already exists and is tested; `syncRules()` composes it.
- **New dependency: `pdf-parse`** (pure-JS PDF text extraction, no native/build-step requirement) — the only realistic way to satisfy §7.2's "vendored CPG PDF in the KB" without hand-rolling PDF parsing; keeps I6 (`tsx`, no build step) intact since it's a plain npm dependency, not a native addon.
- **Legality chunk is written to disk but the fetch is never skipped** — satisfies both "offline search <1s after sync" (§11) for legality content already synced, and I2's "never served from cache... when asserted" by making the *sync* step (not the *read* step) always hit the network; FAB-021/022 read the already-fresh-as-of-last-sync chunk for search/show, but a live `rules ask` touching legality per §7.4 still needs its own live check at ask-time — that's explicitly FAB-021/022's job, not FAB-020's (FAB-020 only guarantees sync-time freshness).
- **No Rules Reprise ingestion here** — §7.2a is FAB-024's explicit scope; FAB-020's `document` union intentionally excludes a `"reprise"` variant so FAB-024 can add it without touching FAB-020's chunking code for the other four sources.
- **Single legality chunk, not sub-sectioned** — the policy page isn't written in numbered sections like CR/TRP/PPG; splitting it would risk losing legality facts across an arbitrary boundary, which is worse than one larger chunk for a content type that's read whole anyway (I2 already forces callers to re-fetch live for anything legality-asserting).

## Out of scope for this task (FAB-020)

- `rules search` / `rules show` (FAB-021), `rules ask` (FAB-022), Rules Reprise ingestion (FAB-024), Card Vault rulings in `cards show` (FAB-023) — all separate tasks consuming `kb/rules/index.json` or extending the `document` union.
- Brain seeding (E3) — reads from this KB once it exists but isn't part of building it.

## Addendum — FAB-021: `rules search` / `rules show`

Grounded in: SPEC §7.3, §7.4, §10 I1, I2.

### Components

- `src/rules.ts` gains three new exports:
  - `searchRules(query: string, opts?: SearchRulesOptions): Promise<RulesChunk[]>` — ranked search over `kb/rules/index.json`.
  - `showRulesChunk(ref: string, opts?): Promise<RulesChunk | null>` — resolve a single chunk by a reference string (see below).
  - `refreshLegality(opts?): Promise<RulesSyncResult>` — extracted from `syncRules()`'s existing private `syncLegality()` so it can be called standalone (legality-only, no CR/TRP/PPG/CPG refresh) — reused internally by `syncRules()` unchanged, and newly called directly by `searchRules()`/`showRulesChunk()` per the legality-live rule below.
- `src/commands/rules.ts` gains `rules search <query>` and `rules show <ref>` subcommands, output styled like `lore search`/`lore show` (ranked list with document/section/source_url, then a `show` full-chunk dump) — reuse that command's chalk/formatting idiom, not a new style.

### Interfaces / contracts

- **TTL auto-refresh (§7.3)**: before searching/showing, check `kb/rules/index.json`'s `builtAt` age. If older than `RULES_TTL_MS` (default 7 days, env-overridable — mirror `src/lore.ts`'s `FAB_LORE_TTL_MS` pattern, name it `FAB_RULES_TTL_MS`), call the existing `syncRules()` to refresh the whole KB before searching. If `kb/rules/index.json` doesn't exist yet at all, this is also "stale" (age = infinite) — trigger the same refresh (first-run bootstrap, matching `lore.ts`'s missing-index behavior).
- **Legality-always-live (§7.4, invariant I2 — hard rule, independent of the TTL check above)**: whenever a search's results include one or more `document: "legality"` chunks, OR `show`'s resolved chunk is a legality chunk, call `refreshLegality()` to re-fetch the live policy page **before** returning that chunk's content to the caller — every single call, never skipped even if the TTL check above just ran a full sync moments earlier in the same invocation (a full sync's legality fetch already satisfies this for that call, so don't double-fetch in the same invocation — but a `search`/`show` call that did NOT trigger the TTL path must still independently refresh legality if its results touch it).
- **`showRulesChunk(ref)` reference resolution**: `ref` accepts `<document>/<section>` (e.g. `"cr/1.1"`, case-insensitive on document) matching a chunk's `document`+`section` fields, OR a slug matching the chunk filename (`slugSection(section)`, reusing the existing exported... — if `slugSection` isn't exported yet, export it) for cases where `section` isn't a clean lookup key (CPG chunks, whose `section` IS already the slug). Ambiguous/no match → print candidates (search-style) and exit 1 — do not guess. Note: `lore show`'s own resolver (`findDoc()`) has no equivalent behavior (it silently picks the first match by priority order and never sets a non-zero exit code), so this is `rules show` establishing a stricter, more correct convention, not mirroring an existing one — a worthwhile fast-follow would backport candidate-printing + exit-1 into `lore show` for consistency.
- **Ranking**: simple term-overlap scoring is sufficient (matches `lore.ts`'s existing search approach — no need for a new dependency); rank primarily by how many query terms appear in `title`+`text`, tie-broken by `document` then `section`. Snippet in results should show the matched context, not the full chunk text (full text is `show`'s job).
- **Offline speed (§11, this task's AC)**: a `search`/`show` call that does NOT need a TTL refresh or a legality touch must complete in-process reading `kb/rules/index.json` from disk only — no network call at all in that path. This is the concrete meaning of "offline search <1s after sync."

### Decisions

- **Legality-live is enforced at the search/show layer, not baked into `syncRules()`** — FAB-020 already guarantees sync-time freshness; FAB-021 adds the query-time guarantee SPEC §7.4 actually requires ("IF a query... touches legality-policy content"), which is necessarily about search/show, not sync. The two freshness guarantees are independent and both must hold.
- **No new ranking/search dependency** — reuse the plain term-overlap approach already proven in `src/lore.ts`, keeping `rules.ts` consistent with the sibling KB module's idiom and avoiding an unnecessary dependency for a CLI-scale corpus (~850 chunks).
- **`refreshLegality()` is extracted, not duplicated** — `syncRules()`'s internal legality step and `searchRules()`/`showRulesChunk()`'s query-time legality check must be the exact same code path (same live fetch, same write-through-preserving-last-known-good behavior on failure) — extracting it once avoids the two call sites drifting.

### Out of scope for FAB-021

- `rules ask` (FAB-022) — composes `searchRules()`'s results with the Discord-escalation footer; not this task.
- Rules Reprise ingestion (FAB-024) and Card Vault rulings (FAB-023) — unaffected, no `document` union change here.

## Addendum — FAB-022: `rules ask` with Discord escalation

Grounded in: SPEC §7.5, §10 I1, I7.

### Components

- `src/rules.ts` gains one new export: `askRules(question: string, opts?: SearchRulesOptions): Promise<AskRulesResult>` — thin composition over the existing `searchRules()`, adding a confidence judgment. No new HTTP/KB logic; this task is pure composition on top of FAB-021's retrieval layer.
- `src/commands/rules.ts` gains `rules ask "<question>"` — prints the passages `searchRules()` returns (same citation format as `rules search`'s result list — document/section/source_url/snippet) followed by the escalation footer, ALWAYS, every call, with no flag to suppress it.

### Data model

```ts
export interface AskRulesResult {
  passages: RulesChunk[];      // same objects searchRules() already returns
  confident: boolean;          // false => passages don't clearly settle the question
}
```

### Interfaces / contracts

- **Confidence heuristic**: `rankRulesChunks` currently returns only the ranked `RulesChunk[]`, discarding its internal per-chunk score/matched-term-count. Export a scored variant — `rankRulesChunksScored(chunks, query, limit): { chunk: RulesChunk; score: number; matchedTerms: number; totalTerms: number }[]` — and have the existing `rankRulesChunks` become a thin wrapper over it (`.map(r => r.chunk)`) so there is exactly one ranking implementation, not two. `askRules()` calls `searchRules()` for the passages (reusing its TTL/legality-live guarantees unchanged) AND separately needs the scored breakdown to set `confident` — call the scoring function on the same underlying chunk set `searchRules()` used (do not re-rank differently; `confident` must be judged from the SAME ranking that produced the returned passages, or the "low-relevance" signal and the actual passages shown could disagree).
- **Confidence rule**: `confident = false` when EITHER (a) `passages.length === 0` (nothing matched at all), OR (b) the top-ranked result's `matchedTerms / totalTerms < 0.5` (fewer than half the query's real terms appear anywhere in the best passage — a weak/partial match, not a genuine hit). This is a simple, testable, deterministic threshold — not a subjective judgment call left to the dev agent; implement exactly this rule.
- **Escalation footer — ALWAYS printed, unconditionally** (§7.5's "ALWAYS print the escalation line" — not just on low confidence): `judge Discord #ask-a-judge — https://discord.com/channels/874145774135558164/1020649907314495528`. WHEN `confident` is `false`, this footer is additionally highlighted/prefixed (e.g. a warning-colored line above it: "passages don't clearly settle this — ") per §7.5's "prominently marked ... when passages don't settle the question." The footer text and link never change; only whether the extra highlight precedes it changes.
- **Answers contain ONLY KB-sourced text + citations (I1)**: `rules ask`'s output must not synthesize prose "answering" the question — it prints the retrieved passages verbatim (or as snippets, same as `rules search`) with their citations, plus the fixed escalation footer. No LLM-generated summary/paraphrase of passage content; the command itself does no interpretation, only retrieval + composition + the footer.

### Decisions

- **No new KB/HTTP logic — pure composition** — `askRules()` must not duplicate `searchRules()`'s TTL-refresh or legality-live logic; it calls `searchRules()` directly and gets those guarantees for free. This keeps the "one code path" principle from FAB-021's `refreshLegality()` decision consistent here too.
- **Confidence threshold is a plain, deterministic function of the SAME scored ranking `searchRules()` computed** — not a second, independently-tuned relevance model — so the escalation-highlight decision can never contradict the passages actually shown.
- **`rankRulesChunksScored` is the single ranking implementation; `rankRulesChunks` becomes a wrapper** — avoids the two-separate-scoring-functions drift risk (same reasoning as FAB-021's `refreshLegality()` extraction: one code path, not two that could diverge).

### Out of scope for FAB-022

- Any LLM-composed/summarized answer text — deliberately out per invariant I1; this command retrieves and cites, it does not "answer" in a generative sense.
- Rules Reprise ingestion (FAB-024), Card Vault rulings (FAB-023) — unaffected.
