# HANDOFF — FAB companion app build loop (session 01EysHtmuW6BJUFuJf5smDbE, 2026-08-01→02)

## Mission
Autonomous build loop (`/loop /spec-workflow:build-next — APP-* tasks only`) executing SPEC-APP.md:
a React Native FAB companion app — on-device SLM Q&A (RAG-grounded, versioned artifacts), card
scanning, catalog + QR — plus its training pipeline. Spec was crafted this session (3 research
rounds, 6 agent reports → 3 adversarial Fable-5 review rounds: REJECT → REVISE → APPROVE).

## Authoritative documents
- `SPEC-APP.md` (root) — 16 §s, EARS, invariants; 3 deltas folded (applied/: APP-002, APP-004, BUG-182, BUG-186)
- `docs/BACKLOG-APP.md` — 45 tasks APP-001…085 + spawned bugs; docs/spec-deltas/applied/
- `.claude/project.yaml` — spec `app` [APP], 8 epics; board = GitHub project #4 Zugruul/fab-cli
- Research dossier: `/Users/vieiral/.claude/jobs/703017a7/tmp/slm-spec-requirements.md`
- `docs/rights-assessment.md` — per-source redistribution assessment (AWAITING USER SIGN-OFF)

## Board state (25 items Deployed, ~24 merged PRs #167–#205)
- **E0 complete** (APP-001..004): pnpm monorepo (fab-cli/, fab-app/, pipeline/, manifest-schema/),
  brains at root, per-package licensing (fab-cli GPL-3.0-only, others MIT), board paths migrated.
- **E1 complete** (APP-010..017 + bugs 176/190): corpus exporter (6801 chunks, stub-enforced
  shipping modes, chunks.jsonl vs chunks-fulltext.jsonl split), teacher QA gen (resumable,
  cost-capped, mock-tested), rejection sampling (rejectionKind infra/quality split; content-hash
  staleness guard + cross-file supersession), behavior datasets (distractor/abstention/OOD/DPO),
  dataset versioning + stratified split + leakage tests + legality guard (in assembleDataset),
  adjudication-critical predicate + flag, rights assessment (exporter-enforced).
- **E3 autonomous set complete** (APP-030..035): RN scaffold (llama.rn, op-sqlite+sqlite-vec,
  vision-camera, fast-tflite; root .npmrc node-linker=hoisted; op-sqlite sqliteVec config in ROOT
  package.json; fab-cli/bin/fab.js uses tsx/cjs/api), artifact manager (resumable/atomic/
  tombstones/revocation), compatibility+provenance UI, retrieval engine (hybrid seeding, link
  expansion w/ clamp, activation ranking, manifest floors; p95 7-25ms), memory lifecycle
  (recovery-first, tier selection), first-run onboarding.
- **@fab/manifest-schema**: 5 manifest types; SPDX regex+denylist; Confidence enum (§10.2
  contract); tombstones; either-embedder delta rejection; oodThreshold<retrievalFloor invariant;
  cross-linked fixtures; shippedContentHash (pending merge, see in-flight).

## IN-FLIGHT (first actions after /clear)
1. **PR #206** (BUG-198, branch `fab/BUG-198-retrieval-hardening`, worktree
   `/Users/vieiral/.claude/jobs/703017a7/tmp/lane-bug198`): link-weight clamp + cycle tests +
   schema invariant. Delivered, red-purity verified.
2. **PR #207** (BUG-191, branch `fab/BUG-191-shipped-hash`, checked out in PRIMARY repo):
   shippedContentHash both sides + mode-flip proof. Delivered, red-purity verified.
   Real hashes: content 971fab7e…, shipped 6594ce90… (differ because lore=stub).
3. **BOTH gates exited 1 in my last verification run** — UNRESOLVED whether the recurring flakes
   (talishar-bootstrap network step; scripts-python 5s timeout under load) or real failures.
   → FIRST: re-run `npm run gate > /tmp/g.log 2>&1; echo $?` in each checkout, diagnose honestly.
4. Then: reviewer rounds (spawn a reviewer agent; house pattern below) → merge #207 then #206
   (serialized, re-gate second on fresh main — note orchestrator/regate-second-merge-on-fresh-main)
   → board chains (#191, #198: In progress → In review → QA → Ready → Deployed, labeled passes
   `pass:"spec-compliance"`+`pass:"code-quality"` via telemetry.py before QA) → task-close events
   → retro mint if novel → next picks.

## Remaining board work
- **Autonomous**: #199 (clearFallback wiring from installer), #202 (knowledge-pack sizeBytes).
- **HUMAN-GATED**: #126 rights-assessment sign-off (4 items: LSS commercial-entity clause;
  Service-App text coverage; Nathan Eastwood lore outreach; mode table) — holds at QA.
  APP-036 (#144) TestFlight — needs Apple Developer account + bundle id.
  Pending consent: file flaky scripts-python test as board issue (user never answered).
- **E2 training tasks** (APP-020..029, 085 built? NO — E2 tasks not yet started except via E1;
  check `board.sh next`): need dataset (teacher runs need ANTHROPIC_API_KEY) + the 5090.

## storm590x (training machine — WORKING SSH, env fix in progress)
- `~/.ssh/config` alias `storm590x` → 192.168.1.17, user `leona`. BatchMode key-auth VERIFIED.
- WSL2 Ubuntu 24.04 mirrored networking; RTX 5090 24463MiB, CUDA 13.3, driver 610.43.02
  (`/usr/lib/wsl/lib/nvidia-smi` — NOT on non-interactive PATH); 94GB RAM; 883GB free ext4;
  tmux/rsync/git present; default shell zsh (use full paths / bash -lc).
- `~/.venv` (python 3.12.3, **uv-managed, NO pip module**): torch 2.6.0+cu124 — **LACKS sm_120**
  (Blackwell) → CUDA kernels fail. uv is at `~/.local/bin/uv` (not on PATH).
  **NEXT COMMAND** (was about to run):
  `ssh -o BatchMode=yes storm590x '~/.local/bin/uv pip install --python ~/.venv/bin/python3 --upgrade torch --index-url https://download.pytorch.org/whl/cu128'`
  then verify: arch list contains sm_120 → 4096² matmul smoke → `import unsloth`.
- `/mnt/f/Development/fab/.venv` exists but torch/unsloth combo broken + DrvFs slow — do not use.
- Remote-dispatch task NOT yet filed on the board (file under EI or APP-020 scope when env green).
- A separate agent is building a `compute-resources` skill from a brief we wrote (copy at
  `/tmp/claude-501/response.md`); this session should NOT duplicate that work.

## Process contracts (essential to keep the loop identical)
- **Auto-merge consent is PER-SESSION**: user granted "Yes, this session" — a fresh session MUST
  re-ask via AskUserQuestion before its first autonomous merge (auto-review.md §0).
- Scripts: `B=~/Development/development-skills/plugins/spec-workflow/scripts/board.sh`; gate.sh,
  telemetry.py, identity.sh, brain.sh, feedback.py same dir. Gate = `npm run gate` at repo root;
  record via gate.sh (In-review moves hook-gated on recorded pass matching CURRENT primary tree —
  lane tasks' moves wait until primary is stable).
- Red-first hook: branch's FIRST commit must touch ONLY test files (test/ dirs, *.test.*,
  _test.py now recognized). package.json/vitest wiring = separate second commit. Violations →
  rebuild via detached worktree cherry-picks + NEW branch + close old PR (force-push is
  classifier-DENIED; colon-refspec push also denied — create local branch then push it).
- QA transitions need BOTH labeled review passes recorded first; move ONE status at a time,
  never chain moves after fallible steps (two incidents this session).
- Working tree carries permanent orchestrator dirt (.claude brain events, VERSIONS.txt, AGENTS.md
  untracked): never stage; `git stash push .claude/project.yaml` dance for branch switches
  (assistant-skills block is uncommitted user state).
- Dev/reviewer identities via identity.sh flags; dev = sonnet. Reviews are adversarial; devs get
  what/how/why briefs with strict scope lists + red-first warnings; verify agents' claims
  yourself (gate, red purity via `git show --name-only <red-sha> | grep -cv test`).
- Retro at PR close: mint via `echo "..." | brain.sh mint dev <slug> --tags ... --source ... --confidence direct`;
  commit as orchestrator identity on main. Feedback batches via feedback.py (autoTriage OFF).
- Plugin repo `~/Development/development-skills` has UNCOMMITTED fixes from this session:
  seed-board.sh thorough bodies + SKILL.md, red-first-preflight.sh patterns. User aware.
- 18 retro notes minted this session (dev: monorepo-cwd-relative-outputs, derive-root-from-
  import-meta-url, red-commit-test-files-only, pre-commit-generated-file-check, dependency-
  isolation-scan-values, audit-bug-class-not-instances, per-entry-failure-isolation,
  pnpm-rn-hoisting-gotchas, data-before-marker-durability, format-regex-plus-denylist,
  metric-honesty-separate-infra-failures, recovery-first-state-machines, cross-store-
  supersession; orchestrator: replacement-branch-instead-of-force-push, no-chained-board-moves,
  regate-second-merge-on-fresh-main, inspect-lane-on-silent-idle; reviewer: restructure-pr-
  review-order).

## Stop-hook goal active
"Fix tasks on board to be up to new standard then /loop /build-next APP-* only" — board
standardization DONE (45 bodies embed full backlog blocks + artifacts sections; verified);
loop was running. Fresh session: resume the loop directive.

## Post-handoff addendum (session-close retro, 2026-08-02 ~08:45Z)
- Final feedback batch (4 items) emitted + triaged: 2 notes minted (orchestrator/
  adversarial-review-cadence, orchestrator/durable-handoff-with-expiring-consents), 1 upstream
  (gate-pass should be per-lane — development-skills), 3 aged links pruned, retro #32 marked,
  feed archived. Retro commit ab5d6bc6 accidentally landed on PR #207's branch (primary was
  checked out there) and was cherry-picked to main as 3d17dc34 — identical content, so those
  paths drop out of #207's squash diff at merge; no action needed, just don't be surprised the
  PR branch carries it.
- RESOLVED (was in-flight item 3): both gate exit-1s were fab-app retrieval perf.test.ts
  blowing its 50ms p95 bound under concurrent gate load — standalone p95 = 9.60ms, both PRs'
  code fine. Next session: re-run gates when the machine is quiet (expect green), then proceed
  straight to reviews/merges. Consider a perf-test load-tolerance follow-up alongside the
  scripts-python flake (same consent-pending filing).
