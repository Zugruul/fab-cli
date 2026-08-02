/**
 * SPEC-APP.md §7.9 final-output enforcement guard (APP-015): a scan over
 * the ASSEMBLED, SPLIT dataset (assemble.ts's output — the last point
 * before write.ts persists train.jsonl/eval.jsonl) that FAILS THE BUILD
 * LOUDLY if any fact-SFT-bound example is grounded in a live legality/
 * ban-list chunk.
 *
 * This is defense-in-depth on top of what already exists:
 *  - behavior/dpo.ts already excludes legality chunks from DPO pairs at
 *    construction time (isLegalityChunk check, skipped with a reason).
 *  - assemble.ts already excludes legality chunks from QA examples (both
 *    the sampling-accepted and qa-pairs-fallback paths) and re-checks DPO
 *    pairs defensively.
 * Audited gap this guard closes: assemble.ts does NOT re-derive
 * isLegalityChunk for distractor examples — it trusts upstream
 * behavior/distractor.ts's `timeSensitive` marking completely. A
 * hand-crafted or buggy distractor.jsonl artifact carrying a legality
 * chunk_id but `timeSensitive: false` would pass straight through assembly
 * into the dataset with no filter catching it (see
 * dataset.legality-guard-cli.test.ts, which reproduces exactly this via
 * the real `dataset:build` CLI). This guard is the first check that
 * re-derives isLegalityChunk from the actual chunk data for every example
 * type, independent of what each builder claims about itself.
 *
 * Distractor examples are the ONE category §7.9 allows to carry a legality
 * chunk as grounding — but only in the shape behavior/distractor.ts
 * produces: `timeSensitive: true`. A distractor example whose chunk_id IS a
 * legality chunk but ISN'T marked timeSensitive is a violation too — that
 * shape means legality content entered a retrieval-context position
 * without the "this data can go stale" marker the spec requires, which is
 * a real training-data hazard even though the example's target answer
 * itself isn't grounded in the legality chunk.
 *
 * DPO pairs are checked at the PAIR level (one chunk_id per pair, per
 * dpo.ts — `chosen` and `rejected` always cite the pair's single source
 * chunk, or no citations at all for synthetic-degraded `rejected`
 * variants), so there's no separate chosen-vs-rejected split to reason
 * about here: excluding the pair by its `chunk_id` already covers the
 * `chosen` answer, which is the half that actually bakes the chunk's facts
 * into a preferred completion (see dpo.ts's own §7.9 doc comment).
 *
 * abstention/ood examples carry no fact grounding from a source chunk
 * (abstention's chunkId is audit-only and never in contextChunkIds; ood
 * has no chunk_id at all — see types.ts's DISJOINT_CATEGORIES doc) so
 * they're never checked.
 */
import type { Chunk } from "../types.js";
import { isLegalityChunk } from "../behavior/legality.js";
import type { DatasetExample } from "./types.js";

export interface LegalityGuardViolation {
  exampleId: string;
  exampleType: DatasetExample["exampleType"];
  chunkId: string;
  reason: string;
}

export interface LegalityGuardResult {
  ok: boolean;
  violations: LegalityGuardViolation[];
  /** Count of examples this guard actually evaluated (qa/distractor/dpo
   * with a resolvable chunk_id) — excludes abstention/ood and any example
   * whose chunk_id isn't in the provided chunk set (unresolvable chunk ids
   * are assemble.ts's concern, already noted there; this guard only judges
   * what it can actually classify as legality or not). */
  checked: number;
}

export function runLegalityGuard(examples: DatasetExample[], chunks: Chunk[]): LegalityGuardResult {
  const chunksById = new Map(chunks.map((c) => [c.chunk_id, c]));
  const violations: LegalityGuardViolation[] = [];
  let checked = 0;

  for (const ex of examples) {
    if (ex.exampleType === "abstention" || ex.exampleType === "ood") continue;

    const chunkId = ex.chunkId;
    if (!chunkId) continue;
    const chunk = chunksById.get(chunkId);
    if (!chunk) continue;
    checked++;

    if (!isLegalityChunk(chunk)) continue;

    if (ex.exampleType === "distractor") {
      if ((ex.payload as { timeSensitive: boolean }).timeSensitive) continue; // allowed §7.9 shape
      violations.push({
        exampleId: ex.id,
        exampleType: ex.exampleType,
        chunkId,
        reason: "distractor example grounded in a legality chunk but not marked timeSensitive — not the §7.9 carve-out shape",
      });
      continue;
    }

    violations.push({
      exampleId: ex.id,
      exampleType: ex.exampleType,
      chunkId,
      reason: `${ex.exampleType} example grounded in a legality/ban-list chunk — fact-SFT training data must not learn legality content per SPEC-APP.md §7.9`,
    });
  }

  return { ok: violations.length === 0, violations, checked };
}

/**
 * Throws (aborting the build) when `runLegalityGuard` finds any violation.
 * Called from INSIDE dataset/assemble.ts's assembleDataset(), right after
 * its checkLeakage self-check — so every caller of assembleDataset gets
 * this guarantee (not just dataset/cli.ts's main(), which would otherwise
 * be the one trusted place doing verification while any other programmatic
 * caller got unguarded output straight from assembly).
 */
export function assertLegalityGuard(examples: DatasetExample[], chunks: Chunk[]): void {
  const result = runLegalityGuard(examples, chunks);
  if (result.ok) return;

  const lines = result.violations
    .map((v) => `  - ${v.exampleType} ${v.exampleId} (chunk ${v.chunkId}): ${v.reason}`)
    .join("\n");
  throw new Error(
    `legality guard (SPEC-APP.md §7.9): ${result.violations.length} violation(s) — legality/ban-list ` +
      `chunk(s) present in fact-SFT-bound dataset output. Build aborted before write.\n${lines}`,
  );
}
