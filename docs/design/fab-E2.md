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

## Addendum — FAB-023: Card rulings in `cards show` (Card Vault)

Grounded in: SPEC §7.6, §10 I1, I10.

### Components

- `src/cardvault.ts` (existing, from earlier work) already has `fetchCardVaultCard(cardId)` returning `CardVaultCard` with a `rulings_errata: unknown[]` field (currently untyped/unused beyond a count, per the precedent in `src/commands/fabtcg.ts`'s `card` command). This task:
  1. Types `rulings_errata` properly (see Data model below) — the LIVE shape of a non-empty entry could not be confirmed during design (every card sampled across a broad, varied set — commons, bans, complex heroes — returned an empty `rulings_errata` array; the API field may simply be sparsely populated by LSS today). The dev agent MUST do one more targeted live probe before finalizing the type (try a wider/different card sample, check for an alternate endpoint, or inspect the Card Vault website's own rendering if any card there shows rulings) — but must NOT block on finding a real example; if genuinely always empty right now, type defensively (see below) and rely entirely on a synthetic fixture for the non-empty test path. This is explicitly allowed — the AC's "no official rulings" empty-state path is a first-class, always-correctly-testable requirement regardless of live data density.
  2. Adds a `fetchCardRulings(cardName: string): Promise<CardRuling[] | null>` (or similar) helper: resolves a `fabrary` card's display name to a Card Vault `card_id` via `searchCardVault({ name })` (existing function), then calls `fetchCardVaultCard()`. Returns `null` when no Card Vault match is found at all (graceful fallback — different from "found the card, zero rulings").
  3. `src/commands/cards.ts`'s `show` action (the ONLY call site in scope — this is `fabrary cards show`, not `fabtcg card`) gets a new section after the existing card detail render: rulings/errata, dated list with citation, or "no official rulings" when the card was found on Card Vault but has zero entries, or nothing/a distinct "not found on Card Vault" note when no match at all (don't conflate these two empty states — AC says "no official rulings" specifically for the zero-rulings-found case).

### Data model

```ts
export interface CardRuling {
  date: string | null;      // whatever date field the live shape actually has, or null if absent
  text: string;              // the ruling/errata text itself
  raw?: unknown;              // defensive: the original object, for any field the typed shape misses
}
```
The parser (`parseCardRuling(entry: unknown): CardRuling`) must be defensive — Card Vault's real shape is unconfirmed at design time. Extract `date`/`text` from whichever keys are actually present (try common candidates: `date`/`ruling_date`/`created_at`; `text`/`ruling_text`/`description`/`body`) and fall through to a reasonable default (`date: null`, `text: String(entry)`) rather than throwing, so an unexpected real-world shape degrades to "a ruling exists, shown as best-effort text" instead of crashing the whole `cards show` command.

### Interfaces / contracts

- `fetchCardRulings(cardName)` returns:
  - `null` — no Card Vault match found for this card name at all (network-reachable but zero search results, OR the search/detail call fails — both cases are "graceful fallback," per AC).
  - `[]` — a Card Vault match was found, but it has zero `rulings_errata` entries — renders as "no official rulings."
  - `CardRuling[]` (non-empty) — renders as a dated list, most-recent-first if dates are available (stable original order if not), each entry citing the source: the card's own Card Vault URL (`https://cardvault.fabtcg.com/card/<card_id>/` — same URL pattern already used by `fabtcg card`'s rulings-count line), since individual ruling entries likely don't carry their own distinct URL (unconfirmed, but this matches the one confirmed source-citation mechanism already in the codebase).
- Card name → Card Vault search: use `searchCardVault({ name: <fabrary card's display name> })` and take the top result's `card_id` (mirrors how `fabtcg card` already resolves a search hit). Card name mismatches (fabrary's identifier-derived title-case names, e.g. "Fyendals Spring Tunic" losing an apostrophe per this repo's own documented `CLAUDE.md` limitation) may occasionally miss a real Card Vault match — that's an accepted, pre-existing cross-referencing limitation (same one `CLAUDE.md`'s "Known Limitations" section already documents for card-name apostrophes), not a new defect to solve in this task.
- Network: this hits `api.cardvault.fabtcg.com` live, same as the rest of `cardvault.ts` — no caching layer required (matches the existing module's behavior, no TTL/disk-cache precedent to violate here). Must be entirely mocked in gate-time tests (I4).

### Decisions

- **Scope is `fabrary cards show` only** (FAB-023's literal AC target, §7.6) — `fabtcg card` already has its own (count-only) rulings display; this task does NOT change `fabtcg card`'s existing behavior, only adds a new, richer rulings section to the OTHER command (`fabrary cards show`). Out of scope to unify the two commands' rulings rendering — that's a hypothetical future cleanup, not this task.
- **Defensive parsing over a confirmed schema** — since live data couldn't confirm the real `rulings_errata` entry shape during design, the parser must degrade gracefully on an unrecognized shape rather than assume field names with confidence. Do not treat this as "guessing" that violates I1/I10 (never answer from remembered card text) — this is purely about how to DISPLAY whatever real API data returns, not about fabricating rules content; the actual ruling text always comes verbatim from the live API response.
- **"No official rulings" (found, zero entries) is distinct from "not found on Card Vault" (no search match)** — the AC's exact phrase ("no official rulings" when empty) refers to the former; conflating the two would misrepresent a lookup failure as an authoritative "this card has no rulings" claim, which is itself a form of answering from insufficient grounding (I1-adjacent risk) — keep them visibly different in output.

### Out of scope for FAB-023

- `fabtcg card`'s existing rulings-count display — unchanged.
- Rules Reprise ingestion (FAB-024) — unaffected, different KB entirely (rules KB vs. Card Vault).

## Addendum — FAB-024: Rules Reprise / release-notes ingestion

Grounded in: SPEC §7.2a, §7.2b, §10 I1, I8.

### Components

- `src/rules.ts` gains a `syncReprise()` step in `syncRules()`'s orchestration, following the EXACT same pattern as `syncCpg`/`syncLegality` (per-source failure isolation, supersession via `replaceChunks`, a `RulesSyncResult` entry). `RulesDocument`'s union grows to `"CR" | "TRP" | "PPG" | "CPG" | "legality" | "reprise"` (FAB-020/021 deliberately reserved this variant for this task — see their design sections).
- **Discovery mechanism (confirmed live)**: `GET https://fabtcg.com/api/wp/v2/posts?search=rules+reprise&per_page=<N>&page=<P>`, using `FABTCG_HEADERS`/`httpFetch` (same as the rest of `fabtcg.ts` — full browser headers required, confirmed live: a bare `curl` without them 403s). Verified live against the real API during design: the search reliably surfaces every "Rules Reprise: <Set Name>" article (e.g. `rules-reprise-omens-of-the-third-age-constructed`, `rules-reprise-high-seas-limited`) plus occasional adjacent "Rules Update" posts as an incidental but welcome side effect (their titles also relate to rule changes) — no dedicated WP category/tag reliably scopes these (the `categories` field was empty or a different taxonomy ID inconsistently across sampled articles, not a usable filter).
- Paginate through all result pages (WP's `per_page`/`page` params) until a page returns fewer than `per_page` results, with a safety cap (`MAX_REPRISE_ARTICLES = 200`) to bound worst-case ingestion size — SPEC doesn't mandate a specific volume, and the live corpus today is small (dozens, not hundreds), so this cap is a safety rail, not an expected limit in practice.
- Each WP post's `content.rendered` (HTML) is converted to plain text via the SAME `stripHtml()` helper `syncLegality()` already uses (script/style stripped, tags stripped, entities decoded, whitespace collapsed) — no new HTML-parsing logic. `title.rendered` may itself contain HTML entities (WP escapes titles too) — run it through the same entity-decoding step.

### Data model

No new top-level type — `reprise` chunks use the EXISTING `RulesChunk` shape:
```ts
{
  document: "reprise",
  section: <post slug>,       // e.g. "rules-reprise-omens-of-the-third-age-constructed"
  title: <decoded post title>, // e.g. "Rules Reprise: Omens of the Third Age Constructed"
  sourceUrl: <post's `link` field>, // the real fabtcg.com/articles/... URL, confirmed live
  version: <post's `date` field>,   // ISO-ish string WP already provides, ready-to-use as-is
  fetchedAt: <sync timestamp>,
  text: <stripHtml(content.rendered)>,
}
```
One chunk per article (not sub-sectioned — a Rules Reprise article is a single cohesive piece analyzing a handful of interactions for one set/format, unlike CR/TRP/PPG's numbered-section structure; sub-splitting would fragment closely-related interaction discussions for no benefit, mirroring the legality chunk's same "one chunk, not sub-sectioned" reasoning from FAB-020).

### Interfaces / contracts

- `syncReprise(kbDir, fetchedAt, opts?): Promise<RulesSyncResult>` — same signature shape as the sibling per-source sync functions, called from `syncRules()`'s orchestration alongside CR/TRP/PPG/CPG/legality. On any HTTP/network failure at any page, degrade to `status: "failed"` with whatever chunks were already collected from earlier successful pages (or, simplest and matching the CPG/CR precedent's all-or-nothing per-source behavvior, treat any page failure as a whole-source failure and preserve the PRIOR sync's chunks via `replaceChunks`'s existing "only replace on success" semantics — dev agent's call between these two, but must not partially replace only some of a document's previous chunk set, matching the existing supersession contract's atomicity).
- Search discovery is env-overridable for tests but NOT for legality-style "always live" semantics — reprise content changes far less frequently than legality (new articles appear per-set-release, not continuously), so it follows the SAME TTL-refresh-on-`rules search`/`show` model as CR/TRP/PPG (FAB-021's `isIndexStale()` check), NOT the legality-always-live model. This is a deliberate distinction: I2's hard "always live" rule is specific to card-legality content, not general rules commentary.
- `rules search`/`show` (FAB-021, already merged) require ZERO changes — they already operate generically over `kb/rules/index.json` regardless of `document` value, so reprise chunks surface in search results automatically once `syncRules()` writes them. The AC's "rules search surfaces them alongside CR/TRP/PPG hits" is satisfied purely by `syncReprise()` populating the index correctly — confirm this with an integration-level test (sync with a reprise fixture, then `searchRules()` a term known to appear in that fixture, assert a `document: "reprise"` chunk is among the results) rather than assuming it "just works."

### Decisions

- **Discovery via WP search, not a dedicated taxonomy** — confirmed live that Rules Reprise articles don't share a reliable `categories`/`tags` value; free-text search on the literal series name ("rules reprise") is the only mechanism that reliably surfaced every sampled article across a 2024–2026 date range in the live probe. If LSS later adds a stable taxonomy, that would be a cheap future improvement, not a blocker now.
- **One chunk per article, not sub-sectioned** — matches the legality chunk's precedent reasoning (a cohesive piece, not a numbered-rules document); sub-splitting a Rules Reprise article's prose would lose context between related interaction discussions.
- **NOT legality-always-live** — reprise content follows the same TTL-based freshness model as CR/TRP/PPG, since I2's "always fetch live" rule is legality-specific, not a general rule for all fabtcg.com content; conflating the two would slow down every `rules search`/`show` call for no invariant-mandated reason.
- **Reuse `stripHtml()` — no new HTML→text logic.** Consistent with FAB-020's "no new HTML-parsing logic" precedent for the legality page.

### Out of scope for FAB-024

- Any dedicated "release notes" (distinct from "Rules Reprise") ingestion beyond what the "rules reprise" search query incidentally surfaces (e.g. an adjacent "Rules Update" post) — SPEC §7.2a's explicit example and this task's AC are both Rules-Reprise-specific; a broader release-notes taxonomy sweep is a future enhancement, not required here.
- Any change to `rules ask` (FAB-022, already merged) — it composes over `searchRules()` unchanged, automatically benefiting from reprise chunks with zero code change, same reasoning as `rules search`/`show` above.

## Addendum — FAB-025: Vendor flesh-and-blood-cards submodule + `cards local` offline search

Grounded in: SPEC §5, §7.7.

### Status quo (confirmed before writing this addendum)

Most of this task's deliverables already exist on `main`, landed ahead of the board (per the OWNER's 2026-07-10 comment on issue #22, cross-referenced from #23/FAB-033): the `third_party/flesh-and-blood-cards` submodule is vendored with its pin committed (`.gitmodules` confirmed), `src/carddb.ts` (`loadCardDb`/`searchLocalCards`) exists and is real, working code, and `fab-cli fabrary cards local` (`src/commands/cards.ts`) is fully wired and documented in `CLAUDE.md`. The OWNER's comment explicitly named the ONLY remaining gap: **fixture tests for `src/carddb.ts`'s offline search**, deferred at the time because E0's gate tooling didn't exist yet. E0 (and every subsequent epic) is long since Deployed — this task's entire remaining scope is closing that one gap.

### Components

- `src/carddb.ts` needs a small, additive testability change: `loadCardDb()` currently resolves `CARD_DB_PATH` from `__dirname` with no override, and caches the parsed JSON in a module-level `let cache` with no reset — both make it untestable against a fixture without monkeypatching the filesystem. Add an optional path parameter: `loadCardDb(dbPath: string = CARD_DB_PATH): LocalCard[]`, and change the cache to be KEYED by the resolved path (a `Map<string, LocalCard[]>`) rather than a single module-level value — so a fixture-path call and the real default-path call never collide or pollute each other across test runs, and repeated calls with the SAME path still hit the cache (preserving the existing perf characteristic for the real CLI path). Thread the same optional `dbPath` through `searchLocalCards(terms, opts)` — either as a new `opts.dbPath` field, or a separate parameter; dev agent's call on whichever composes more naturally with the existing `LocalSearchOptions` shape, but it must not change the DEFAULT (no-`dbPath`-given) behavior observably for the real `cards local` command.
- No changes to `src/commands/cards.ts`'s `local` action — it doesn't need a `--fixture`/test-only flag; the CLI always uses the real submodule path. The new parameter exists purely for `test/carddb.test.ts` to point at a small synthetic fixture.
- New `test/fixtures/carddb/card.json` — a small (5-10 entry) synthetic card array matching `LocalCard`'s real shape (`name`, `pitch`, `cost`, `power`, `defense`, `types`, `card_keywords`, `granted_keywords`, `ability_and_effect_keywords`, `functional_text`), covering: a card matched by name-scope, a DIFFERENT card matched only by text-scope (mentions the first card's name in its own functional text — the classic "search text mentions X" case CLAUDE.md documents for the online `cards search --text` flag's identical semantics), a card matched by keyword-scope, cards with distinct pitch/cost/type values to prove filters actually filter (not just pass everything through), and one card whose name collides case-insensitively with another for the `--exact` lookup test.

### Interfaces / contracts

- `searchLocalCards(terms, opts)`'s existing behavior for every currently-documented flag (`scope: name|text|keyword|any`, `exact`, `pitch`, `cost`, `type`, `limit`) must be preserved exactly — this task adds test coverage and one additive testability parameter, it does NOT change matching semantics. If writing the fixture tests reveals an actual bug in the existing matching logic (not merely "untested," but "wrong"), STOP and report it — fixing a real bug found via new tests is in scope, but redesigning working matching logic is not.
- AC's "filters match online `cards search` flags where data supports them" is a CONFIRMATION check, not new work: compare `LocalSearchOptions`'s fields against `src/commands/cards.ts`'s existing ONLINE `search` command's flag set (already registered, read it) and note in the PR description which flags have an offline equivalent and which don't (e.g. does `--class`/`--talent`/`--subtype`/`--rarity` from the online search exist offline? `searchLocalCards`'s `class` filter currently checks `c.types` — the same array `type` checks — meaning "class" isn't actually a distinct filter from `type` today; this may be a pre-existing minor gap worth a one-line note in the PR, not a redesign).
- "Full-corpus search works offline" AC: in addition to fixture tests, run one live smoke against the REAL vendored submodule data (already on disk, no network needed) as manual verification — not a gated test, since gate tests must use the small fixture (a full-corpus JSON parse in every `npm run test:run` invocation would be needlessly slow for a unit suite, and the real submodule's exact card count changes over time as LSS prints new sets, which the fixture tests must NOT depend on).

### Decisions

- **Path-keyed cache over a cache-reset function** — a `Map<string, LocalCard[]>` keyed by resolved path is simpler and more correct than adding a `resetCardDbCache()` escape hatch tests would need to remember to call in `afterEach`; it also matches how a real (non-test) caller could theoretically point at a different path without stale-cache surprises, though in practice only the CLI's fixed real path is ever used outside tests.
- **No CLI-level `--fixture` flag** — the testability change is internal-only; `fab-cli fabrary cards local` always searches the real vendored submodule, matching its documented behavior with zero surface-area change for end users.
- **This task does not redesign `class` vs `type` filter semantics** even though they're currently identical — that's an existing, working (if perhaps under-differentiated) behavior; scope is testing what exists and fixing genuine bugs the new tests uncover, not a filter-semantics redesign.

### Out of scope for FAB-025

- Adding new filter flags beyond what `searchLocalCards`/`cards local` already support (e.g. a hypothetical `--rarity`/`--talent` for offline search) — not named in this task's AC; a later task if wanted.
- Any change to the online `cards search`/`cards show` commands — this task is offline-search-only.
