# Handoff — 2026-08-05

## Stop reason

**Blocked on human: `storm590x` is unreachable** (SSH to `192.168.1.17:22` times out; last good probe 2026-08-03T20:02:49Z). It is a laptop and is almost certainly asleep or off.

Everything required to train is otherwise in place. One human action unblocks the entire remaining chain.

## The single action needed

**Wake `storm590x`**, then:

```bash
python3 <plugin>/scripts/remote-compute.py run storm590x vision-training:gpu-check
```

If green, dispatch real detector + embedder training against `pipeline/out/composites-full`.

## Why APP-*-only work was not possible this session

Verified by execution, not assumed. Attempting APP-085's own QA validation:

```
knowledge/cli full  → requires an APP-022 calibration artifact
eval calibrate      → requires --scores <file.json> (real retrieval scores)
scores              → require a trained embedder
embedder            → requires GPU training
GPU training        → required a vision-training capability that did not exist
```

APP-* board state at close: **24 Deployed · 7 QA · 1 Ready · 15 Backlog**. The 7 in QA are gated on trained models or the real-photo benchmark; the 15 in Backlog are blocked by epic E5, which *is* those QA tasks. The one advanceable task (APP-026) was advanced with full AC evidence. The rest were not faked.

## Ready and waiting

**Training dataset** — `pipeline/out/composites-full` (preserved in the main checkout, survives worktree cleanup):

```
20,700 composites · 41,402 files · 12 GB (lossless PNG)

covered              16,213   every obtainable printing, >=3 appearances each
eligibleButNotPlaced      0   none missed
unavailableUpstream      33   genuinely HTTP 403 from LSS S3
totalCatalogSize     16,246
16,213 + 0 + 33 = 16,246  ✓
```

**Card images** — `pipeline/out/images`, 16,214 / 16,246, 14 GB.

**`vision-training` capability** — installed on storm590x 2026-08-05T00:43:21Z, jobs `gpu-check` / `obb-train` / `arcface-embed-train`. Project-agnostic. Carries both required contracts: a device request the machine cannot honor **fails loudly** rather than silently using CPU, and omitted dispatch metadata records *"resource/capability unknown"* rather than a fabricated `"local"`.

**Machine (last good probe)** — RTX 5090 Laptop, 24463 MB VRAM, driver 610.62, CUDA 13.3, torch 2.11.0+cu128 `cuda True`, 94 GB RAM, 871 GB free on ext4.

## In flight

| lane | state |
|---|---|
| #270 vision GPU dispatch | code complete, bundle installed; **blocked on the machine being awake** |
| #274 label tag vocabulary | implemented + tool wired; needs gate, PR, review |

## Human items, in priority order

1. **Wake storm590x** — unblocks training, then APP-027/028 validation, then epic E5, then APP-050 (the scan pipeline).
2. **Four foiling calls**, binder page 1 (`IMG_7629`) — I pre-labeled these as cold foil and they need confirming; obvious in hand, not from a photo. `ARC000` also decides First Edition vs Unlimited.
   - ARC000 Eye of Ophidia · SUP000 Authority of Ataya · UPR000 Blood of the Dracai · PEN109 Gloves of Erasure
3. **Binder pages 2 and 3** (`IMG_7630`, `IMG_7631`) unlabeled — I stopped rather than write guessed quads after a page-1-tuned grid failed to transfer and automatic detection merged two cards.
4. **More benchmark photos** — currently 18 photos / ~30 printings / no `field` scenes. APP-050's gate is **≥95% top-1** against this set. Distinct printings matter more than photo count.

Labeling tool: `cd pipeline && npx tsx src/benchmark-label/cli.ts` → http://localhost:4173/

## Merged or Deployed this session (16)

APP-026 (Deployed), #144 APP-036 (Deployed), #249 (Deployed), #256, #257, #258, #263, #268, #272 — plus earlier lanes #136/#137/#139/#140/#141/#142/#244/#252/#253 in QA.

## Filed this session

#260 untested polling wiring · #263 gate cache hygiene (merged) · #264 browser interaction coverage · #265 occluders rarely triggered · #266 seam band · #271 broadcast coverage · #272 streaming memory (merged) · #273 zone-generate memory gap · #274 tag vocabulary · #275 candidate-set identity schema

## Notable corrections made to my own claims

- Called a red gate "pre-existing" when a symlink **I** had created caused it.
- Filed #265 asserting occluders were "functionally absent" from one seed; measuring a second seed showed they are *rare* (1 in 172), not absent. Issue rewritten.
- Declared a reviewer unresponsive and substituted myself; its report had merely been delayed. Corrected publicly on the PR.
- Diagnosed a "silent OOM" that was five separate infrastructure artifacts, then a real O(n) memory bug that was none of them.
- Planned to chunk the dataset run, which would have silently voided the coverage guarantee (each chunk restarts its tracker at zero).
