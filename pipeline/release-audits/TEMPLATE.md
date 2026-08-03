# Major-version human-audit sample review

SPEC-APP.md §8.5's second clause: "for major versions a human-audited sample review is
additionally required before release." This is that review's record.

Copy this file to `pipeline/release-audits/<candidate-version>.md` (e.g.
`pipeline/release-audits/2.0.0.md`), fill it in completely, and pass its path to
`npm run eval -- release --version <candidate-version> --audit-record pipeline/release-audits/<candidate-version>.md`.
The release gate (`src/eval/release.ts`'s `checkReleaseGate`) reads only the `## Sign-off`
section's `Verdict:` line — everything else here is the human record of *why* that verdict was
reached, kept for provenance. **A blank or placeholder `Verdict:` line is deliberately not a
completed sign-off** (`extractAuditVerdict` returns `null` for it) — the gate blocks the release
with a "no completed sign-off" message rather than treating an unfilled template as silent
approval.

## Candidate

- Version: `<major.minor.patch>`
- Previous released version: `<major.minor.patch>`
- Eval run summary: `<path to summary.json / release-gate-result.json for this candidate>`
- Auditor: `<name>`
- Date: `<YYYY-MM-DD>`

## Sample selection guidance

Draw the sample from the same eval-suite pool the automated harness scored, stratified so the
audit isn't blind to where the automated suites are weakest:

- Include every item the automated suites scored `incorrect` on the `adjudication-critical` and
  `human-authored-adjudication` suites (small in a healthy candidate — read all of them).
- Add a random sample (recommended: at least 20, or 10% of the suite's item count, whichever is
  larger) of `correct`-scored items from `adjudication-critical`, `interactions`, and
  `human-authored-adjudication` — an automated "correct" verdict from the rubric judge is not
  itself ground truth; the audit exists to catch judge miscalibration, not just judge-flagged
  misses.
- Spot-check a handful of `abstention-quality`/`ood-rejection` items — confirm the model is
  abstaining for the right reason (insufficient grounding / out-of-domain), not just producing
  text that happens to pattern-match "abstain".
- Prefer items covering rules categories/keywords that changed or were added since the previous
  major version, since those have the least prior audit history.

## Per-item audit

Repeat this block per sampled item (or use a table with these columns: Item ID | Question |
Model answer | Automated verdict | Human verdict | Notes).

- Item ID: `<eval item id>`
- Question: `<verbatim question text>`
- Model answer: `<verbatim model output>`
- Automated verdict: `<correct | incorrect | abstained>`
- Human verdict: `<agree | disagree — correct | disagree — incorrect | disagree — should abstain>`
- Notes: `<why, citing the grounding source when the disagreement is about rules accuracy>`

## Summary

- Items reviewed: `<n>`
- Disagreements with the automated verdict: `<n>` (`<list item ids>`)
- Any adjudication-critical disagreement found: `<yes/no — if yes, this alone should drive a
  BLOCK sign-off below, regardless of the automated §8.5(a)/(b)/(c) signals>`

## Sign-off

- Auditor: `<name>`
- Date: `<YYYY-MM-DD>`
- Verdict: <APPROVE | BLOCK>
