import { z } from "zod";

/**
 * SPEC-APP.md §14: the two shipped model tiers (1.7B on ≥6GB RAM, 0.6B
 * otherwise). Extracted to its own module — rather than living inline in
 * modelPack.ts, where it originated — so benchmarkResults.ts (APP-024,
 * issue #136) can import the tier enum without a modelPack.ts ⇄
 * benchmarkResults.ts import cycle: modelPack.ts embeds an optional
 * `benchmarkResults: BenchmarkResultSchema` field, and BenchmarkResultSchema
 * itself needs `tier` to record which tier a device run measured.
 * modelPack.ts re-exports both names from here so no existing import of
 * `ModelPackTierSchema`/`ModelPackTier` from "./modelPack.js" breaks.
 */
export const ModelPackTierSchema = z.enum(["1.7B", "0.6B"]);
export type ModelPackTier = z.infer<typeof ModelPackTierSchema>;
