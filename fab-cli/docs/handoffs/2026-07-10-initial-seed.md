# Handoff — 2026-07-10 · Initial seed session (setup-project + craft-spec + brain seeding)

## Board snapshot
- Board: https://github.com/users/Zugruul/projects/4 ("fab-cli", 6-stage pipeline, Priority P0-P2, Estimate)
- **Deployed:** FAB-030 (identities+ROLE.md), FAB-031 (player brain seed), FAB-032 (judge brain seed)
- **Backlog (next pick = FAB-001):** E0 quality (001-004) → E1 refactor/http/json (010-012) → E2 knowledge bases (020-025) → E3 remaining (033 card-interaction memories) → E4 live follow (040) → E5 prep (050)
- Closed as deferred: FAB-041 (merged into 040), FAB-060/061/062 (research docs → SPEC §12 deferred decisions)

## What this session produced
1. **Workflow adoption:** `.claude/project.yaml` (VALID; 5 identities incl. player/judge; autoMerge squash; feedback on), SPEC.md (EARS requirements, invariants I1-I10), docs/BACKLOG.md, labels, board seeded.
2. **Brains (the session's core deliverable):**
   - Player: ~270 notes — full CR walk, 187 kw-* keyword notes + keywords-index, format specs, card-anatomy-visual.
   - Judge: ~580 notes — CR adjudication depth, full TRP (incl. all appendices), full PPG catalogs, 187 kw-* + 295 gl-* glossary notes with indexes, doc-map-cr/trp/ppg, staying-current-protocol, card-anatomy-visual.
   - Orchestrator: 3 process-lesson notes from the retro.
3. **Vendored artifacts:** `third_party/fab-rules/` (CR/TRP/PPG + VERSIONS.txt; `fab-cli rules update-docs [--commit]` validates+refreshes), `third_party/flesh-and-blood-cards` submodule (4,862 cards), `docs/references/` (casual guide PDF, learn-to-play transcript, card-anatomy/ annotated images).
4. **Hard rules (in ROLE.md files + SPEC invariants + project.yaml + CLAUDE.md + core memory):** judge = source of truth, one-way knowledge flow judge→player, judge neutrality (no play advice, no private-info leaks), cite-or-silence, legality always live, card doubts via exact text + CR, keyword/glossary re-index on version bumps, vendored-repo freshness (24h TTL).

## Running state
- Neural view: `http://127.0.0.1:4748` (python3 …/spec-workflow/scripts/neural-view.py start|status|stop; data reload requires restart — upstream issue filed in feedback).
- Gate is NOT green yet by design: `npm run gate` chains typecheck+lint+format+test but lint/test tooling lands in FAB-001 (first loop task).
- Feedback feed: `.claude/feedbacks/feed.yaml` — 6 items all routed (3 upstream to development-skills, 3 minted).

## How to resume
- Start the loop: `/spec-workflow:build-next` (one iteration) or `/loop /spec-workflow:build-next` (autonomous; auto-merge is ON).
- Pause anytime: checkpoint skill. Board queries: board.sh next/list.
- Ask the player/judge anything FAB: they answer from their brains, verify against `third_party/fab-rules/`, escalate to #ask-a-judge when unsettled.

## Gaps / known issues
- brain.sh mint indexes links only at mint time — after bulk note writes, rebuild links.json (see orchestrator note `brain-bulk-writes-need-link-reindex`); upstream fix requested.
- board.sh: `prio` wants issue numbers (not task ids); `comment` may reject valid bodies (use `gh issue comment`).
- macOS has no `timeout` command — don't use it in batch scripts here.
- PPG A.1 quick-reference table not separately noted (redundant with severity-ladder + catalogs); CR "Acknowledgments" chapter intentionally skipped.
