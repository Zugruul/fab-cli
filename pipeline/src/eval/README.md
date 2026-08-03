# Eval harness (SPEC-APP.md §8.3-§8.5, §13 invariant 8 — APP-022 #134, APP-023 #135)

The eval harness that scores a candidate model before release: trichotomy scoring
(correct/incorrect/abstained) with asymmetric penalties, eight named suites, per-embedder
calibration, regression comparison against the previous release, per-suite scores landing
in `@fab/manifest-schema`'s `ModelPackManifest.evalScores`, and the release-gate enforcement
policy (thresholds + major-version human-audit requirement) that turns those measurements into
a hard pass/block release decision — see "Release gate" below.

Architecture is grounded in `docs/design/app-E2.md` — read that first for the component map and
data models. This README is usage-focused.

## Gate-stub mode vs real commands

**`npm run gate` (repo root or `pipeline/`) never calls this harness's CLI.** The gate is
`pipeline/`'s own vitest suite (`test/eval.*.test.ts`), which exercises every module — scoring,
scorers, suites, calibration, regression, gate signals, the runner, the manifest mapping —
against fixtures, a deterministic stub `ModelClient`, and a mocked `RubricJudgeClient`. Network
is never touched in the gate (SPEC-APP.md §13 invariant 10).

`npm run eval -- run` is a **dev-facing command**, not part of the gate. By default (`--stub`,
also the default with no flag) it runs the same deterministic stub model client
(`stubClients.ts`'s `createAlwaysCorrectStubModelClient`) and mocked rubric judge against
whatever dataset/content is actually on disk — useful to smoke-test the wiring end to end
(suite building → scoring → gate signals → manifest mapping → written artifacts) without a real
model. It reads `pipeline/out/dataset/eval.jsonl` if present (empty array if not — a missing
dataset build is not an error, it just means the seven dataset-sourced suites report zero
items, which correctly FAILS the §8.5(b) minimum-correct floor rather than silently passing) and
the committed `pipeline/eval-suites/human-adjudication/*.json` content (always present).

`npm run eval -- run --real` is intentionally **not implemented** yet — it fails loudly
(`no real on-device ModelClient is wired up`) rather than silently falling back to the stub. A
real on-device model run needs the remote-compute rails this epic doesn't reach (deferred: the
GPU box for a real model pass is off — see `docs/design/app-E2.md`'s Out of scope). The
rubric-judge side of a real run, in contrast, already works structurally today —
`scorers/rubricJudge.ts`'s `buildRubricJudgeClient(engineId)` reuses `qa/engine.ts`'s
`TeacherClient` abstraction (the same claude-code-subscription/anthropic-api dual-engine
discipline #223 built), not a new transport — it's just never wired into `cli.ts`'s `--real`
path because there's no real model to pair it with yet.

```bash
npm run eval -- run                        # --stub, all defaults
npm run eval -- run --out /tmp/eval-run    # override output dir
npm run eval -- run --previous prev-scores.json   # §8.5(c) regression comparison input
npm run eval -- calibrate --embedder-version text-embed-v1 --scores scores.json
```

Every `eval run` writes `summary.json` (raw `EvalRunSummary`), `manifest-eval-scores.json` (the
`ModelPackManifest.evalScores`-shaped fragment — `manifestIntegration.ts`'s `toManifestEvalScores`
output, ready to splice into a real release manifest), and `gate-result.json` (§8.5 a/b/c breach
list + pass/fail) under `pipeline/eval-runs/<timestamp>/` (gitignored — regenerable, and a
`--stub` smoke run isn't a meaningful result to commit). Exit code is nonzero iff the gate
result's `passed` is false.

## Release gate (§8.5 enforcement policy — APP-023, #135)

`gate.ts`'s `checkGate()` only PRODUCES the raw §8.5(a)/(b)/(c) breach signals from an
`EvalRunSummary` — it never decides whether a release is actually allowed. `release.ts`'s
`checkReleaseGate()` is the enforcement policy: it consumes `checkGate()` unchanged (never
reimplements the threshold math) and adds the one thing §8.5's second clause requires that
`checkGate()` explicitly defers: **for a major-version candidate, a completed human-audited
sample review is additionally required before release.**

```bash
npm run eval -- release --version 2.0.0 --previous-version 1.4.0 \
  --audit-record pipeline/release-audits/2.0.0.md
```

- **Major-version detection**: the candidate's major component is strictly greater than
  `--previous-version`'s (e.g. `2.0.0` vs `1.4.0` → major). With **no** `--previous-version` at
  all (first-ever release), the candidate is *also* treated as major — there's no release
  history to compare against, so the human-audit step is the only quality gate a first release
  gets beyond the automated suites.
- **Audit requirement**: for a major-version candidate, `--audit-record <path>` must point at a
  completed copy of `pipeline/release-audits/TEMPLATE.md` (copy it to
  `pipeline/release-audits/<version>.md`, fill it in, commit it — these are permanent
  provenance records, not regenerable output, same discipline as `pipeline/training-runs/`).
  The gate reads only that file's `## Sign-off` → `Verdict: APPROVE` / `Verdict: BLOCK` line
  (`release.ts`'s `extractAuditVerdict`); a missing path, a missing file, or the template's own
  unfilled `Verdict: <APPROVE | BLOCK>` placeholder are all treated as "no completed sign-off"
  and block the release — an unfilled template can never pass as a silent approval. A recorded
  `BLOCK` verdict blocks the release outright regardless of what the automated suites say; only
  a recorded `APPROVE` clears this check.
- **Version parsing is a runtime guard, not just a TS type**: `--version`/`--previous-version`
  must be strict `MAJOR.MINOR.PATCH` (no `v` prefix, no pre-release suffix) — a malformed
  version decides whether the audit gate applies at all, so it throws loudly
  (`InvalidVersionError`) rather than silently parsing into something that skips the check.
- A non-major bump (e.g. `1.5.0` vs `1.4.2`) never requires `--audit-record` — only
  `checkGate()`'s (a)/(b)/(c) signals apply.

`eval release` writes the same `summary.json`/`manifest-eval-scores.json` as `eval run`, plus
`release-gate-result.json` (`ReleaseGateResult`: `passed`, `breaches` — `checkGate()`'s breaches
plus, when present, one `"8.5-audit"`-clause breach — `isMajorVersion`, and the unmodified
underlying `gate` result) under `pipeline/eval-runs/<timestamp>/`. Exit code is nonzero iff
`passed` is false. Like `eval run`, it always runs `--stub` (no real on-device model is wired up
yet); this is the release-gate signal a real publish script would consume before uploading an
artifact (§8.9), not itself the publish step.

## Suite registry

`suites/registry.ts`'s `SUITE_REGISTRY` is the single data-driven table for all eight §8.4
suites — adding a suite means one entry here plus its item source, not new runner logic (mirrors
`fab-app/src/i18n/locales/index.ts`'s locale-registry precedent). A module-load self-check
throws if the registry and `@fab/manifest-schema`'s canonical `EVAL_SUITE_IDS` ever drift apart.

Seven suites are dataset-sourced (`suites/fromDataset.ts`, reading the assembled dataset's eval
split — `pipeline/out/dataset/eval.jsonl`, §7.7-§7.8): `adjudication-critical` (consumes the
PRECOMPUTED `adjudicationCritical` flag on every `DatasetExample` — never re-derives it, per
BUG-186/§8.4), `interactions`, `lore`, `citation-validity`, `abstention-quality`,
`ood-rejection`, `distractor-robustness`. The eighth, `human-authored-adjudication`, is committed
content (`suites/humanAuthored.ts`) — see below.

Each item's scorer is picked from `EvalItem.expected.kind` (`exact` for canonical categories —
keyword-definitions, card-facts, per §8.3 — `rubric` for everything else) EXCEPT
`citation-validity` (its own structural scorer: is the model's cited chunk actually in the
item's known-correct grounding set?) and `abstention-quality`/`ood-rejection` (their own
scorer: the only correct behavior is abstaining — see `SuiteScorerKind` in `suites/registry.ts`).

## Calibration artifacts

`calibration.ts`'s `calibrate(embedderVersion, samples, config)` computes, per embedder version,
the §9.7 retrieval-confidence abstention floor (a low percentile of CORRECTLY-answered items'
retrieval scores) and the §10.9 OOD fast-path threshold (`retrievalFloor * oodMarginRatio`,
`oodMarginRatio` in (0,1) — algebraically, and additionally runtime-checked, strictly below the
floor). This is the SAME `retrievalFloor`/`oodThreshold` pair `@fab/manifest-schema`'s
`KnowledgePackManifestSchema` already carries and enforces (`oodThreshold < retrievalFloor`) — no
new schema was needed for calibration; `eval calibrate`'s artifact is built to feed that existing
field pair directly, recorded under `pipeline/eval-runs/calibration/<embedderVersion>.json`
(gitignored — regenerable).

## Adding a human-authored-adjudication item

Content lives under `pipeline/eval-suites/human-adjudication/*.json` (committed, one file per
source batch) — each file a JSON array of:

```json
{
  "id": "reprise-example-01",
  "question": "...",
  "expectedClaims": ["one or a few faithful sentences transcribing the source's actual ruling"],
  "groundingChunkIds": ["rules/reprise/<article-slug>"],
  "sourceUrl": "https://fabtcg.com/articles/<article-slug>/",
  "adjudicationCritical": false
}
```

`sourceUrl` is REQUIRED and runtime-checked (not just TS-typed) on every load — §8.4's
anti-circularity control means every item must cite an independent, verifiable source (Rules
Reprise worked examples, #ask-a-judge-equivalent rulings), never be teacher-generated. Content
is TRANSCRIBED, not authored: `expectedClaims` must be a faithful paraphrase of what the source
actually says, never an added/invented fact. `rules/reprise/**` grounding is valid HERE even
though it's explicitly excluded from the `adjudication-critical` suite (§8.4 draws that line at
"the rules text itself" vs. Reprise's worked-example commentary on it) — set
`"adjudicationCritical": false` accordingly (the loader defaults it to `false` if omitted).

Before adding a batch, run `fab-cli rules sync` (from `fab-cli/`, dev-time only — network
allowed at dev time, NEVER in tests/gate) if `fab-cli/kb/rules/reprise/*.md` needs refreshing;
each chunk's frontmatter `source_url` is the value to transcribe into `sourceUrl`.
`suites/humanAuthored.ts`'s `findNearDuplicateQuestions` (token-Jaccard over question text) is
worth running against a new batch before committing it —
`test/eval.humanAuthoredContent.test.ts` runs it against the whole committed set in the gate, so
a near-duplicate addition fails there.
