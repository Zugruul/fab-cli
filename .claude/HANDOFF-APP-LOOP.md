# HANDOFF — FAB companion app build loop (session 703017a7 close, 2026-08-02 ~21:45Z)

Authoritative resume doc for `/loop /spec-workflow:build-next — APP-* tasks only`.
Supersedes all prior versions of this file.

## Board state at close
- **Deployed this session (all with full chains, telemetry, retros):** #191, #198, #199,
  #202, #208 (storm590x dispatch lib), #209 + #210 (both gate-flake fixes — false exit-1s
  under load are gone), **#132 APP-020** (PR #216: training runner, real-5090 AC run, first
  committed run records at pipeline/training-runs/ac-tiny-sft-0620/), **#133 APP-021**
  (PR #220: export chain — GGUF+checksums+licensed manifests real-machine-proven; llama.cpp
  smoke code hermetically tested but blocked on env bug #221), **#126** (rights assessment
  SIGNED OFF by user — four answers recorded verbatim on the issue + docs/rights-assessment.md;
  attribution-of-sources is a release requirement; lore stays stub, flip-to-verbatim available
  via future delta). **E1 complete → E2 open.**
- **Queue (P1):** #217 i18n en+pt-BR (user HALTED a just-started attempt — zero code landed,
  back in Backlog; full requirement spec in issue comments), #218 automated a11y in gate,
  #219 dark/light theme (system default) — all three are user directives with scoped comments
  and need SPEC-APP deltas; #221 (llama-cli bug, full 3-build diagnostic on issue);
  #134 APP-022 eval harness; #144 APP-036 TestFlight — **fully credentialed**: app
  "FaB Collections", bundle id io.fabcollections, Apple ID 6797303392, App Store Connect API
  key at ~/.appstoreconnect/private/AuthKey_4ZCWK2K2RT.p8 (ids on issue #144).
- **Human gates remaining:** ANTHROPIC_API_KEY (teacher QA dataset — needed for real E2
  datasets, NOT for fixture-based ACs); pt-BR consent-screen review when #217 lands;
  TestFlight app on the two test iPhones before APP-036's first build.

## Rails (all verified live this session)
- **slm-training capability bundle** (development-skills repo, on ITS main): gpu-check / sft /
  export-gguf / eval jobs, config-file-driven, project-agnostic (test-enforced). storm590x
  registered + enabled for this repo (gitignored .claude/project.local.yaml). PATHS MIGRATED
  by the other agent: registry ~/.remote-compute/, remote jobs ~/.remote-compute/jobs/<id>/,
  caps ~/.remote-compute/caps/<name>/; {capdir}/{jobdir} are now genuinely engine-substituted.
- **pipeline CLIs:** `npm run train` / `npm run export-model` (run/resume/status; state.json per
  transition; committed manifests; cuda/driver REQUIRED on run — read from
  ~/.remote-compute/resources.yaml). REMOTE_COMPUTE_PY env var → engine path.
- **New-machine runbook:** /remote-compute-setup skill + README preflight section (cloneable
  URLs only, $DS pattern). storm590x env: torch 2.11.0+cu128/sm_120, unsloth 2026.7.6,
  python3.12-dev installed, llama.cpp builds at ~/llama.cpp (CPU) — but see #221.
- **Adapters for export tests:** remote ~/.remote-compute/jobs/slmsft4/adapters (post-migration).

## Process contracts (unchanged + new lessons)
- Auto-merge consent is PER-SESSION — re-ask via AskUserQuestion before the first merge.
- Red-first first commit (test files only); one-status-at-a-time board moves; labeled review
  passes recorded before QA; re-gate after ANY main commit (do bookkeeping AFTER board moves);
  estimates set at close; verify agents' claims yourself (red purity, independent gate).
- REAL-TARGET SMOKE before merging any remote-execution surface (5 bugs caught only that way
  this session); reviews of new code use scratch-copy MUTATION testing; proportional review
  depth for tiny diffs; bounded-diagnosis-then-file for third-party infra failures.
- Agents may go idle before/without reports (race or stall) — inspect the lane, don't assume.
  SHUT DOWN teammates at segment end (a /clear preserves the roster; ghosts deadlock goal
  hooks — exact names from ~/.claude/teams/session-<id>/config.json).
- development-skills is SHARED with another active agent: surgical path-scoped commits on the
  current branch only, never push, never stash/switch/rebase there.
- Working-tree dirt rules: never stage .claude brain events/VERSIONS.txt/AGENTS.md; stash
  dance for .claude/project.yaml on branch switches.

## How to resume
1. `board.sh next` → likely #217/#218/#219 (user requirements; each needs a SPEC-APP delta,
   read the issue comments first) or #134 APP-022; #144 APP-036 is unblocked when picked.
2. E2 training beyond fixtures waits on ANTHROPIC_API_KEY → then teacher dataset → real
   SFT/DPO runs via the proven rails.
3. #221 before any task that needs the export smoke green on storm590x.
