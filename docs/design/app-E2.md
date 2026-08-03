# Design — app/E2: Model training & eval

Grounded in: SPEC-APP §8 (all), §7.3–7.8 (dataset inputs), §9.7 (retrieval floor), §10.9
(OOD fast-path), §13 invariants 7/8/10. Written at the first post-training/export E2 task
that needed it (#134 APP-022); records what E2 has already shipped (training runner
APP-020, export chain APP-021, teacher engine #223) plus the eval-harness architecture
APP-022 adds.

## Components

- `pipeline/src/training/` (APP-020, shipped) — `npm run train`: QLoRA SFT run dispatch to
  remote compute (slm-training bundle), state.json per transition, committed run manifests
  (§8.1; first run records at `pipeline/training-runs/`).
- `pipeline/src/export/` (APP-021 + #221, shipped) — `npm run export-model`: merged GGUF,
  quantize, checksums, licensed manifests; optional llama-server smoke (§8.2).
- `pipeline/src/qa/` (E1 + #223, shipped) — teacher-QA generation; dual engines
  (claude-code-subscription default / anthropic-api opt-in), engineId in run manifests.
- `pipeline/src/dataset/` (E1, shipped) — assembly, stratified split (APP-014),
  leakage checks, `adjudication.ts`'s `isAdjudicationCritical(chunkId, tags)` +
  precomputed `adjudicationCritical` flag on every example (§8.4, BUG-186 wording).
- `pipeline/src/behavior/` (E1, shipped) — abstention / OOD / distractor / DPO example
  builders.
- `pipeline/src/sampling/judge.ts` (E1, shipped) — teacher-as-judge for reject sampling;
  the eval harness's LLM-judge is a SEPARATE client with the same TeacherClient-style
  injectable-transport discipline (mocked in gate).
- `pipeline/src/eval/` (#134 APP-022, NEW) — the eval harness:
  - `scoring.ts` — trichotomy per item (`correct | incorrect | abstained`) with
    asymmetric penalties (incorrect ≫ abstain), aggregate per-suite score math.
  - `scorers/` — `exactMatch.ts` (canonical items: keyword definitions, numeric card
    stats) and `rubricJudge.ts` (open answers; rubric derived from source-chunk claims;
    injectable judge client, mocked in gate).
  - `suites/` — suite registry (data-driven, mirroring the repo's registry pattern):
    adjudication-critical (via `isAdjudicationCritical`), interactions, lore,
    citation-validity, abstention-quality, OOD-rejection, distractor-robustness,
    human-authored-adjudication (committed items, see Data models).
  - `calibration.ts` — per-embedder-version calibration of BOTH the abstention retrieval
    floor (§9.7) and the stricter OOD fast-path threshold (§10.9), from eval-set score
    distributions; outputs recorded artifacts, never hardcoded thresholds.
  - `regression.ts` — per-suite comparison vs the previous released version's recorded
    scores (§8.5c input).
  - `runner.ts`/`cli.ts` — orchestrates suites against a MODEL CLIENT abstraction; the
    gate exercises a deterministic stub model client (network off, judge mocked); real
    model runs come later via the remote rails.

## Data models

- EvalItem: `{id, suite, question, expected (rubric | canonical answer | abstain), 
  groundingChunkIds[], adjudicationCritical?, sourceUrl?}` — human-authored suite items
  REQUIRE `sourceUrl` (transcription provenance) and live under committed
  `pipeline/eval-suites/human-adjudication/*` (≥100 items; transcribed from Rules Reprise
  worked examples / #ask-a-judge-style rulings; NOT teacher-generated — the
  anti-circularity control, §8.4).
- SuiteResult: `{suiteId, counts {correct, incorrect, abstained}, score, itemResults[]}`;
  EvalRunSummary: per-suite scores + calibration outputs + model/artifact ids — feeds the
  release manifest (§8.5 / manifest-schema package).

## Interfaces / contracts

- Model under eval is an injectable client interface (like TeacherClient); gate uses a
  scripted stub. LLM-judge likewise injectable; gate uses a deterministic mock.
- Scores land in the release-manifest shape owned by `@fab/manifest-schema` — extend that
  package if fields are missing, never invent a parallel shape (§7.11 rule).
- Human-authored suite: every item carries a `sourceUrl` to the official/independent
  source; items with `rules/reprise/**` grounding are VALID here (worked-example source)
  even though reprise is EXCLUDED from the adjudication-critical suite (§8.4 distinction).
- Gate contract: the whole harness runs against stub model + mocked judge with network
  disabled (§13 invariant 10); real-model eval is an explicit non-gate command.

## Key sequences

1. `eval run` → load suites (registry) → for each item: model client answer → scorer
   (exact-match or rubric-judge) → trichotomy → per-suite aggregate → EvalRunSummary →
   manifest fields + regression comparison vs previous release → exit nonzero on §8.5
   (a)/(b)/(c) breach (the release-gate signal APP-023 consumes).
2. `eval calibrate` → score distributions over the eval set for the active embedder
   version → abstention floor + OOD threshold artifacts (recorded, versioned).

## Decisions

- Suites and scorers are data-driven registries (locale/screen/theme registry precedent) —
  adding a suite is a registration + items, not new harness logic.
- The human-authored suite is committed content with per-item source links; transcription
  happens at dev time (network allowed), the gate only reads committed files.
- Asymmetric penalty weights live in committed config, not code constants.
- Calibration outputs are artifacts (per embedder version), consumed by the app/release —
  §9.7's "not hardcoded" requirement.

## Out of scope for this epic

- Release-gate thresholds/human-audit checklist wiring (APP-023, §8.5 enforcement policy).
- On-device benchmarks (APP-024, §8.6), vision models (§8.7), knowledge packs (§8.8).
- The Q&A experience consuming calibrated floors at runtime (E4).
