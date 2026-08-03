# HANDOFF — FAB companion app build loop (session close 2026-08-03 ~03:45Z)

Authoritative resume doc for `/loop /spec-workflow:build-next — APP-* tasks only`.
Supersedes all prior versions of this file.

## Board state at close
- **Deployed this session (all with full chains — recorded gates, two-pass reviews,
  folded spec deltas, retros, feedback, telemetry):**
  - **#217 i18n** (PR #224 → 9a17d31d; SPEC-APP §9.11): react-i18next, data-driven locale
    registry (en + pt-BR), system-locale default + persisted override, locale-generic gate
    checks (no-literal lint + key parity).
  - **#218 a11y gate** (PR #227 → 8bd8d405; §9.12): react-native-a11y lint + generic
    name/role tree-walker over a SCREENS registry, manual VoiceOver/TalkBack checklist at
    fab-app/docs/a11y-manual-qa.md.
  - **#219 theming** (PR #228 → d38cd012; §9.13): THEMES token registry (9 roles, WCAG AA
    verified both themes), useTheme/useColorScheme system default, color-literal lint +
    token-contrast gate, theme×locale a11y matrix.
  - **#223 teacher engine** (PR #231 → 8066d150; §7.3 revised): claude-code-subscription
    (claude -p headless) is the DEFAULT dataset engine; anthropic-api explicit opt-in only;
    engineId runtime-guarded in manifests. **The old ANTHROPIC_API_KEY human gate is GONE.**
  - **#134 APP-022 eval harness** (PR #232 → 0ce9a70f; §7.11 extended): trichotomy scoring,
    8-suite registry, 141-item human-authored adjudication suite (faithfulness spot-checked
    in review), floor/OOD calibration, EvalScoresSchema required on model packs.
  - **#135 APP-023 release gate** (PR #233 → daa0fcc5): §8.5(a)/(b)/(c) enforcement over
    checkGate(), always-abstain blocked by coverage floor, major-version human-audit
    template with ambiguity-refusing verdict parsing.
- **PARKED (both slots occupied — this is why the loop stopped):**
  - **#221 (In review, APPROVED)** — llama-server smoke vehicle switch. PR #230 approved
    round-1; ds-repo commits cb523ba/b8ad6a8 (LOCAL, UNPUSHED, slm-training paths only).
    Merge waits ONLY on the storm590x real-target smoke. NOTE: branch fab/221-smoke-vehicle
    is now BEHIND main (6 merges since) — rebase + re-gate before merging (merge-freshness
    rule). Upstream llama.cpp bug report prepared and posted on the issue for the user to file.
  - **#144 APP-036 TestFlight (In progress)** — implementation DONE on branch
    fab/144-testflight (pushed, tip dadad61d, gate green): one-command `npm run testflight`,
    bundle io.fabcollections, tester group "Team" created via ASC API, docs. Archive
    SUCCEEDS headlessly; export/upload fails on "Cloud signing permission error" — decision
    options (a) elevate key to Admin / (b) authorized local signing / (c) Xcode GUI sign-in
    are on the issue. Diagnostic cert 24R39SH2X7 live in ASC (revoke if unused; key at
    /tmp/tf-debug/csr/dist.key). Team ID S9ZASLM4D8.
- **Deferred with documented reason:** #136 APP-024 (benchmarks) — backlog "Depends:
  APP-036" unmet; the pick script can't parse prose deps (orchestrator note minted). Do NOT
  start it before #144 completes.
- **Filed this session:** #222 (P2, end-of-line UI refinement pass — carries the user's 4
  bare-minimum surfaces), #225 (P2 perf-test flake), #226 (P2 i18n robustness), #229 (P2
  offline-gate invariant never truly network-severed), #223 (done, above).

## Human gates at close (the loop is fully blocked on these — action lists on the issues)
1. **#144 Apple signing decision** — RECOMMENDED: elevate ASC key 4ZCWK2K2RT to Admin
   (Users and Access → Integrations), reply "apple key elevated". Alt: Xcode GUI sign-in
   ("xcode signed in") or explicit "go with local signing". Then re-run `npm run testflight`
   (fab-app) — on success, SEND THE USER THE TESTFLIGHT PUSH NOTIFICATION (standing
   directive; memory note notify-user-when-testflight-live).
2. **storm590x power-on** — verify `ssh storm590x echo ok`, reply "storm is up". Then:
   rebase fab/221-smoke-vehicle onto main, re-gate, run the llama-server smoke live against
   the box's GGUF, merge PR #230 on green (verdict already recorded), Deployed, retro #221
   (pr-reviewer-pr230 was NOT retro-interviewed — task still open).
3. **pt-BR consent legal review** (release gate, §9.11) and **TestFlight app on the two
   iPhones** — unchanged from before.
4. Optional: file the prepared llama.cpp upstream bug report (full text on #221).

## User directives recorded this session (memory notes exist for all)
- Bare-minimum UI on every fab-app screen until #222's refinement pass; the 4 target
  surfaces (simple chat w/ guards, camera identify+version, add-to-collection button,
  filterable collection screen) are in #222's body.
- Gate must prove ALL configured languages + a11y (done: §9.11-9.13 trio).
- Teacher datasets via the user's Claude subscription, never a paid key (done: #223).
- Notify the user THE MOMENT a TestFlight build is testable (pending on #144).

## Rails / environment facts (new this session)
- Dev/reviewer brains grew ~25 notes with recorded outcomes; recall-injection demonstrably
  prevented repeat findings (both #217 failure modes dead by #218; round-1 zero-finding
  approval on the 6-pt #134). Directory current, retro #36 marked.
- Red-first hook counts ANY non-test-path file as implementation (deps manifests #217,
  jest.config #219) — two history rewrites; upstream feedback filed twice; dev brief rule:
  red commit = test-path files only, everything else after.
- Scratch worktrees: ALWAYS `git worktree add --detach` (a branch-checkout worktree moved
  local main mid-session; repaired).
- fab-app iOS: Xcode 26.5 present, iOS platform component downloaded, pods installed,
  archive proven headless; metro.config watches monorepo root; DEVELOPMENT_TEAM auto-resolved
  from ASC seedId.
- development-skills repo: two local unpushed commits on main (slm-training test+fix for
  #221) — do not push; surgical-commit rules unchanged.
- Working-tree dirt unchanged (never stage): .claude/{brain-events.jsonl, project.yaml,
  neural-view/, identities activation files}, .gitignore, VERSIONS.txt, AGENTS.md,
  .claude/skills/fab-* (other workstream), .claude/.setup-assistant.lock.

## How to resume
1. If the user answered a gate: handle it directly (#144 → retry `npm run testflight`, then
   review/merge PR (open one from fab/144-testflight) + the user's TestFlight ping;
   #221 → rebase/re-gate/live-smoke/merge PR #230).
2. Otherwise `board.sh next` — with both slots parked it will WAIT; the only new-work paths
   run through the two human gates above.
3. Auto-merge consent is PER-SESSION — re-ask via AskUserQuestion before the first merge.
4. Teammates at close: ALL shut down (dev-217/218/219/221/223/134/135/144, reviewers
   pr224/227/228/230/231/232/233 — pr-reviewer-pr230 shut down WITHOUT #221 retro; do it at
   #221's close from its recorded verdicts).
