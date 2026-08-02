/**
 * License identifiers for the export manifest (APP-021, SPEC-APP.md §5, §13
 * Invariants 3 + 9). Pure constants — nothing here probes a license file at
 * export time; the doc comments below record what each value asserts and
 * why it's honest to state statically rather than re-derive per run.
 */
import type { ExportLicenses, ModelTier } from "./types.js";

/** Qwen3's HF model cards (Qwen/Qwen3-1.7B, Qwen/Qwen3-0.6B) publish
 * Apache-2.0 — the same license SPEC-APP.md §5 cites as the deciding reason
 * Qwen3 was chosen as base model ("App-Store-clean, no attribution/flow-down
 * obligations"). Both tiers ship under the same license, so this is a
 * single constant rather than a per-tier lookup table. */
export const BASE_MODEL_LICENSE = "Apache-2.0";

export function buildLicenses(_tier: ModelTier): ExportLicenses {
  return {
    baseModel: BASE_MODEL_LICENSE,
    adapters:
      "Apache-2.0 (LoRA delta trained via Unsloth — itself Apache-2.0 — over " +
      "the Apache-2.0 Qwen3 base; no separate license grant exists for the " +
      "adapter weights alone). Per SPEC-APP.md §5, the unmerged adapter is " +
      "retained as a pipeline artifact for training continuity and is NOT " +
      "shipped.",
    ggufs:
      "Derived artifact: base weights merged with the adapter and requantized " +
      "via llama.cpp — inherits Apache-2.0 from the Qwen3 base per " +
      "SPEC-APP.md §5 and §13 Invariant 9 (Apache-2.0/MIT preferred for any " +
      "shipped artifact; no non-commercial, research-only, or copyleft " +
      "weights ship).",
  };
}
