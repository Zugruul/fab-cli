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
