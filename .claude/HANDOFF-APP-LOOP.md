# HANDOFF — FAB companion app build loop (sessions 01EysHtmuW6BJUFuJf5smDbE → 703017a7, 2026-08-02)

## Mission
Autonomous build loop (`/loop /spec-workflow:build-next — APP-* tasks only`) executing SPEC-APP.md.
This handoff supersedes the previous one entirely; .claude/SESSION-STATE.md was the mid-flight
scratch note and is superseded by this file.

## Board state at close (session 703017a7)
- **Closed this session, all Deployed with full chains + telemetry + retros:**
  #191 (PR #207 shippedContentHash), #198 (PR #206 link-weight clamp — round-2 fix closed a
  negative-weight amplification hole), #199 (PR #211 clearFallback wiring), #202 (PR #212
  knowledge-pack sizeBytes), #208 (PR #213 storm590x dispatch layer — 3 review rounds, real-machine
  smoked), #209 (PR #214 scripts-python 120s timeout), #210 (PR #215 perf p95 retry-once).
- **The board has ZERO unblocked tasks left.** Everything remaining is human-gated:
  1. **#126 rights-assessment sign-off** (docs/rights-assessment.md, 4 items) — holds E1 at QA,
     which blocks ALL of E2 (APP-020..024 training tasks).
  2. **ANTHROPIC_API_KEY** for teacher QA-generation runs (dataset for APP-020).
  3. **#144 APP-036 TestFlight** — 4-step Apple action list posted on the issue.
  4. ~~storm590x python3.12-dev~~ RESOLVED 2026-08-02 ~11:50Z — user installed it; the
     slm-training:sft smoke then passed END-TO-END on the 5090 (2-step QLoRA, adapters +
     train-summary.json round-tripped). Payload fix landed en route: save_strategy=no
     (unsloth-patched trl config classes crash torch.save at checkpoint time). Details #132.

## slm-training capability bundle (user directive, this session)
- Generic, project-agnostic bundle at development-skills
  `plugins/spec-workflow/scripts/remote-capabilities/slm-training/` (capability.yaml +
  gpu_check/train/export_gguf/eval_suite payloads; ONE config file drives every job).
  Committed there as 0106afc on `feat/524-neural-network-compute` (ANOTHER AGENT'S branch —
  never stash/switch/rebase there; commit was surgical; NOT pushed, their call).
- Hermetic tests added to section-remote-compute.sh (job roster, hostile-param refusal,
  payload project-agnosticism, engine training-domain-free); plugin gate.sh PASS recorded.
- storm590x: bundle INSTALLED; `slm-training:gpu-check` AND `slm-training:sft` both verified
  green END-TO-END on the real machine (gpu-check artifact round-trip; sft: real 2-step QLoRA
  on the 5090, loss 2.412→2.399, adapters+tokenizer+train-summary.json pulled back). The
  training dispatch rail is fully proven.
- storm590x ENABLED for this repo (gitignored .claude/project.local.yaml overlay, role training).
- Contract recorded on #132 + memory note `slm-training-capability-bundle.md`: APP-020+ training
  dispatches via `slm-training:*` jobs; project specifics live in pipeline/ configs; extending
  needs = extend the bundle's config surface in development-skills (agnosticism test-enforced).
- UPSTREAM BUG flagged (routed upstream in feedback): engine documents `{jobdir}` as a supplied
  placeholder but never substitutes it; comfyui's manifest depends on it (literal `{jobdir}`
  reaches the shell). slm-training payload reads $COMPUTE_JOB_DIR instead. The other agent was
  actively editing remote-compute.py at session close — may already be fixing it.
- fab-cli's own `pipeline/src/dispatch` (#208) is the lower-level in-repo library; the bundle is
  the preferred loop/operator path.

## Process state
- Auto-merge consent was granted for session 703017a7 ("Yes, this session") — EXPIRED at close;
  a fresh session must re-ask via AskUserQuestion before its first autonomous merge.
- Gate flakes FIXED this session: scripts-python 120s per-test timeout (#209), perf p95
  retry-once (#210) — false gate exit-1s under concurrent lane load should be gone.
- Retros #33/#34 marked. Notes minted this session: dev/clamp-untrusted-numeric-domain,
  dev/background-waits-dont-replace-driving, dev/spread-canonical-fixtures-for-schema-evolution,
  dev/quoting-vs-expansion-tradeoff, reviewer/prove-regression-tests-against-prefix-code,
  orchestrator/bookkeeping-commits-after-board-moves, orchestrator/real-target-smoke-before-merge
  (2 reinforcement outcomes recorded on the last two).
- Upstream items surfaced to human: per-lane gate-pass (prev session), idle-notification/report
  delivery race, {jobdir} placeholder bug.
- Known agent quirk: task agents sometimes go idle before/without their report (twice a race,
  once a real stall) — treat silent idle as lane-inspection trigger, not completion.
- Working-tree dirt rules unchanged (never stage .claude brain events/VERSIONS.txt/AGENTS.md;
  stash dance for project.yaml on branch switches). project.local.yaml is new gitignored state.

## How to resume
1. Ask the human for items 1-4 above (order of leverage: #126 + API key unblock the whole
   training epic; python3.12-dev is 30 seconds; Apple can wait).
2. When #126 signs off: E1 → Deployed, `board.sh next` starts yielding APP-020..024.
3. APP-020 flow: author configs/datasets in pipeline/ (teacher runs need the API key) →
   dispatch via slm-training:* on storm590x → artifacts back via job-pull.
4. Loop contracts: red-first first commit (test files only), one-status-at-a-time board moves,
   labeled review passes before QA, re-gate after any main commit (bookkeeping AFTER moves),
   verify agents' claims yourself, real-target smoke before merging remote-execution surfaces.
