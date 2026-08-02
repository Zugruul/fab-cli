import type { Chunk } from "../types.js";
import type { PairsRecord } from "../qa/pairsStore.js";
import type { SampledRecord } from "../sampling/store.js";
import { isLegalityChunk } from "../behavior/legality.js";
import type { DistractorExample, AbstentionExample, OODExample, DPOPair } from "../behavior/types.js";
import { categorizeChunk } from "./categorize.js";
import { isAdjudicationCritical } from "./adjudication.js";
import { assignSplits, type SplitConfig } from "./split.js";
import { checkLeakage } from "./leakage.js";
import { assertLegalityGuard } from "./legalityGuard.js";
import type { DatasetExample, QAExample, UnsplitDatasetExample } from "./types.js";

export interface AssembleDatasetOptions {
  /** APP-010's exported chunk set (chunks.jsonl). */
  chunks: Chunk[];
  /** APP-011's raw generated pairs (qa-pairs.jsonl) — the fallback QA
   * source, used only when sampling hasn't produced any records at all. */
  qaPairRecords: PairsRecord[];
  /** APP-012's entailment-checked accepted.jsonl, when sampling has run —
   * the preferred QA source. Empty ([]) is a normal "not run yet" state,
   * not an error. */
  acceptedRecords: SampledRecord[];
  /** APP-012's rejected.jsonl — used only to detect whether sampling ran
   * at all (a chunk with zero accepted pairs but some rejected ones is
   * still "sampling ran", not "fall back to raw pairs"). */
  rejectedRecords: SampledRecord[];
  /** APP-013's behavior-training artifacts. Each independently optional —
   * an empty array is a normal "not built yet" state. */
  distractorExamples: DistractorExample[];
  abstentionExamples: AbstentionExample[];
  oodExamples: OODExample[];
  dpoPairs: DPOPair[];
  split: SplitConfig;
}

export interface AssembleDatasetResult {
  examples: DatasetExample[];
  qaSource: "sampling-accepted" | "qa-pairs-fallback";
  /** Honest, human-readable notes about degraded/fallback input states and
   * any skipped records — always present (possibly empty), never silent. */
  notes: string[];
}

function byChunkId(a: { chunk_id: string }, b: { chunk_id: string }): number {
  return a.chunk_id < b.chunk_id ? -1 : a.chunk_id > b.chunk_id ? 1 : 0;
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Combines APP-010's exported chunks, APP-011/012's QA pairs, and APP-013's
 * behavior-training examples into one versioned, categorized, split
 * dataset (SPEC-APP.md §7.7-§7.8). Pure, in-memory, deterministic given
 * (inputs, split config) — see split.ts for the split algorithm itself.
 *
 * QA example sourcing (§7.4's entailment-sampling honesty rule, applied at
 * assembly time): when APP-012's sampling has run for this chunk set
 * (acceptedRecords and/or rejectedRecords non-empty), the QA example set is
 * EXACTLY acceptedRecords — entailment-checked, `entailmentChecked: true`.
 * qa-pairs.jsonl is used only as a wholesale fallback when sampling has not
 * been run at all, with `entailmentChecked: false` on every resulting
 * example and a manifest-visible note — mirrors behavior/dpo.ts's
 * `rejectionSamplingRan` gating pattern exactly, for the same reason: a
 * partial/absent APP-012 run should never silently look like a full one.
 *
 * §7.9: chunks sourced from the live legality policy/ban list are excluded
 * from QA and DPO examples entirely (never learned into weights) — the
 * DPO half of this rule is already enforced upstream by behavior/dpo.ts,
 * re-checked here defensively; the QA half is enforced here for the first
 * time, since qa-pairs.jsonl/accepted.jsonl carry no such filter on their
 * own. Distractor examples are the one place §7.9 allows legality content,
 * but only in the shape behavior/distractor.ts produces (`timeSensitive:
 * true`) — since distractor.jsonl is an upstream artifact this function
 * only trusts, not something it re-derives per field, a final
 * legalityGuard.ts pass (APP-015) below re-checks every assembled example
 * independently of what its builder claims about itself, the same way
 * checkLeakage re-verifies the split rather than trusting assignSplits.
 *
 * The assembled split is self-verified against leakage.ts's checkLeakage
 * AND legalityGuard.ts's assertLegalityGuard before being returned — an
 * assembler that somehow produced a leaked split or let a legality chunk
 * into fact-SFT-shaped output throws rather than returning bad output
 * (mirrors behavior/build.ts's "abort rather than silently under-produce"
 * discipline). This lives HERE, inside assembleDataset itself, rather than
 * in dataset/cli.ts's main() — every programmatic caller of this function
 * gets the guarantee, not just the CLI wrapper.
 */
export function assembleDataset(opts: AssembleDatasetOptions): AssembleDatasetResult {
  const chunksById = new Map(opts.chunks.map((c) => [c.chunk_id, c]));
  const notes: string[] = [];

  const samplingRan = opts.acceptedRecords.length > 0 || opts.rejectedRecords.length > 0;
  const qaExamples: QAExample[] = [];

  if (samplingRan) {
    const sorted = [...opts.acceptedRecords].sort(byChunkId);
    for (const r of sorted) {
      const chunk = chunksById.get(r.chunk_id);
      if (!chunk) {
        notes.push(`qa example ${r.pairId}: source chunk ${r.chunk_id} not found in exported chunk set — skipped`);
        continue;
      }
      if (isLegalityChunk(chunk)) continue; // §7.9
      qaExamples.push({
        id: r.pairId,
        chunk_id: r.chunk_id,
        question: r.question,
        answer: r.answer,
        cited_chunk_ids: r.cited_chunk_ids,
        entailmentChecked: true,
      });
    }
  } else {
    if (opts.qaPairRecords.length > 0) {
      notes.push(
        "sampling has not run (no accepted.jsonl/rejected.jsonl records) — QA examples are built directly " +
          "from qa-pairs.jsonl with no entailment-sampling filter applied; every QA example's entailmentChecked is false.",
      );
    }
    const sorted = [...opts.qaPairRecords].sort(byChunkId);
    for (const record of sorted) {
      const chunk = chunksById.get(record.chunk_id);
      if (!chunk) {
        notes.push(`qa record for chunk ${record.chunk_id}: source chunk not found in exported chunk set — skipped`);
        continue;
      }
      if (isLegalityChunk(chunk)) continue; // §7.9
      record.pairs.forEach((pair, index) => {
        qaExamples.push({
          id: `qa-${record.chunk_id}-${index}`,
          chunk_id: record.chunk_id,
          question: pair.question,
          answer: pair.answer,
          cited_chunk_ids: pair.cited_chunk_ids,
          entailmentChecked: false,
        });
      });
    }
  }

  const unsplit: UnsplitDatasetExample[] = [];

  for (const qa of qaExamples) {
    const chunk = chunksById.get(qa.chunk_id)!;
    unsplit.push({
      id: qa.id,
      category: categorizeChunk(chunk),
      adjudicationCritical: isAdjudicationCritical(chunk.chunk_id, chunk.tags),
      exampleType: "qa",
      chunkId: qa.chunk_id,
      payload: qa,
    });
  }

  for (const d of [...opts.distractorExamples].sort(byId)) {
    const chunk = chunksById.get(d.chunk_id);
    if (!chunk) {
      notes.push(`distractor example ${d.id}: source chunk ${d.chunk_id} not found in exported chunk set — skipped`);
      continue;
    }
    unsplit.push({
      id: d.id,
      category: categorizeChunk(chunk),
      adjudicationCritical: isAdjudicationCritical(chunk.chunk_id, chunk.tags),
      exampleType: "distractor",
      chunkId: d.chunk_id,
      payload: d,
    });
  }

  for (const p of [...opts.dpoPairs].sort(byId)) {
    const chunk = chunksById.get(p.chunk_id);
    if (!chunk) {
      notes.push(`dpo pair ${p.id}: source chunk ${p.chunk_id} not found in exported chunk set — skipped`);
      continue;
    }
    if (isLegalityChunk(chunk)) continue; // §7.9, defense-in-depth (behavior/dpo.ts already excludes these)
    unsplit.push({
      id: p.id,
      category: categorizeChunk(chunk),
      adjudicationCritical: isAdjudicationCritical(chunk.chunk_id, chunk.tags),
      exampleType: "dpo",
      chunkId: p.chunk_id,
      payload: p,
    });
  }

  for (const a of [...opts.abstentionExamples].sort(byId)) {
    // No answer-grounding chunk (sourceChunkId is audit-only — see types.ts's
    // DISJOINT_CATEGORIES doc), so never adjudication-critical.
    unsplit.push({ id: a.id, category: "abstention", adjudicationCritical: false, exampleType: "abstention", chunkId: a.sourceChunkId, payload: a });
  }

  for (const o of [...opts.oodExamples].sort(byId)) {
    unsplit.push({ id: o.id, category: "ood", adjudicationCritical: false, exampleType: "ood", chunkId: null, payload: o });
  }

  if (
    opts.distractorExamples.length === 0 &&
    opts.abstentionExamples.length === 0 &&
    opts.oodExamples.length === 0 &&
    opts.dpoPairs.length === 0
  ) {
    notes.push("no behavior-training artifacts found (pipeline/out/behavior/ absent or empty) — dataset built from QA examples only.");
  }

  const splitAssignment = assignSplits(unsplit, opts.split);
  const examples: DatasetExample[] = unsplit.map((ex) => ({ ...ex, split: splitAssignment[ex.id] ?? "train" }));

  const leakage = checkLeakage(examples);
  if (!leakage.ok) {
    throw new Error(
      `dataset assembly produced a leaked split — ${leakage.overlaps.length} chunk_id(s) appear in both train and eval: ${JSON.stringify(leakage.overlaps)}`,
    );
  }

  assertLegalityGuard(examples, opts.chunks); // §7.9 (APP-015) — see doc comment above

  return { examples, qaSource: samplingRan ? "sampling-accepted" : "qa-pairs-fallback", notes };
}
